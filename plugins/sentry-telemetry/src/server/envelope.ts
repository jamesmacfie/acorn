// acorn's five record kinds, as Sentry envelopes.
//
// This file and ./dsn.ts are the two that speak Sentry. They hold no acorn runtime import: the only
// thing they take from the host is the record vocabulary, as types, which is erased at build. So a
// second Sentry-speaking plugin can lift both as they are.
//
// ## What the wire format actually allows
//
// An envelope is a JSON header line, then items, each its own header line and payload line
// (https://develop.sentry.dev/sdk/foundations/envelopes/). The constraint that shapes everything
// below is that most item types may appear **at most once per envelope**, and `event` and
// `transaction` are mutually exclusive because the envelope header carries the one `event_id` they
// share. So a flush is not one envelope. It is one per error, one per transaction, two per schedule
// run, and one each for the batched logs and metrics.
//
// ## Timestamps are not uniform, and that is Sentry's doing
//
// Events and transactions take an RFC 3339 string or epoch seconds. Logs take a number only. Trace
// metrics take either. Check-in durations are seconds while `max_runtime` and `checkin_margin` are
// minutes. Every conversion here is at the item that needs it rather than at one shared serialiser,
// because there is no one answer to share.
//
// ## What is deliberately not built
//
// Span protocol v2, the standalone `span` item. It is opt-in in Sentry's own SDKs, it breaks
// self-hosted installs, and it needs a dynamic-sampling-context envelope header plus two strictly
// required attributes. A span whose parent is not in the batch goes as a transaction of its own
// carrying `parent_span_id` instead, which is the same thing an SDK does when a trace crosses a
// process, and Sentry stitches the two by trace id either way.
import type { TelemetryAttrs, TelemetryBatch, TelemetryRecord } from '@acorn/protocol/telemetry.ts'
import type { SentrySettings } from '../shared/settings'
import { parseStack } from './stack'

type Span = Extract<TelemetryRecord, { kind: 'span' }>
type Log = Extract<TelemetryRecord, { kind: 'log' }>
type Event = Extract<TelemetryRecord, { kind: 'event' }>
type Metric = Extract<TelemetryRecord, { kind: 'metric' }>
type TelemetryFailure = Extract<TelemetryRecord, { kind: 'error' }>

/** Sentry's own quota names, which is what `X-Sentry-Rate-Limits` speaks. One per envelope, because
 *  one item type per envelope. */
export type SentryDataCategory = 'error' | 'transaction' | 'log_item' | 'trace_metric' | 'monitor'

export type SentryEnvelopeItem = { header: Record<string, unknown>; payload: unknown }

export type SentryEnvelope = {
  category: SentryDataCategory
  /** Everything but `dsn`, `sdk` and `sent_at`, which the transport adds when it serialises. */
  header: Record<string, unknown>
  items: SentryEnvelopeItem[]
}

export type EnvelopeOptions = {
  settings: SentrySettings
  /** From the connection's `config`, and absent when the owner left the field blank. */
  environment?: string
  release?: string
  /** A 32-character hex id, for the envelope-level `event_id` and for records with no trace of
   *  their own. Injected so a test can read the output rather than match it. */
  newId: () => string
}

// ── Small conversions ─────────────────────────────────────────────────────────────────────────────

const seconds = (ms: number): number => ms / 1000

/** Sentry tags are string pairs. Everything on a record is already a scalar, so this only stringifies
 *  and caps at the 200 characters Sentry keeps. */
function tagsFrom(attrs: TelemetryAttrs): Record<string, string> {
  const tags: Record<string, string> = {}
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null) continue
    tags[key] = String(value).slice(0, 200)
  }
  return tags
}

/** The typed attribute shape logs and trace metrics share. Sentry drops an untyped value, and
 *  `integer` and `double` are separate types rather than one `number`. */
function typedAttrs(attrs: TelemetryAttrs): Record<string, { value: string | number | boolean; type: string }> {
  const out: Record<string, { value: string | number | boolean; type: string }> = {}
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null) continue
    if (typeof value === 'string') out[key] = { value, type: 'string' }
    else if (typeof value === 'boolean') out[key] = { value, type: 'boolean' }
    else if (Number.isInteger(value)) out[key] = { value, type: 'integer' }
    else out[key] = { value, type: 'double' }
  }
  return out
}

/** acorn has two span statuses. Sentry has eighteen, and `internal_error` is the one every SDK
 *  reaches for when all it knows is that the thing failed. */
const spanStatus = (status: 'ok' | 'error'): string => (status === 'ok' ? 'ok' : 'internal_error')

/** The renderer's stacks and its errors are a browser's. Everything else in acorn is a Node process,
 *  including the Rust shell's forwarded panic, which has no frames either way. */
const platformFor = (attrs: TelemetryAttrs): string => (attrs.runtime === 'renderer' ? 'javascript' : 'node')

const SEVERITY: Record<Log['level'], number> = { debug: 5, info: 9, warn: 13, error: 17 }

// ── Sampling ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Keep or drop a whole trace, from its id alone.
 *
 * Per trace and not per span, so a transaction never arrives without the children that explain it,
 * and deterministic, so the same trace decided twice decides the same way. FNV-1a over the id, which
 * is 16 lines nobody has to maintain and spreads a hex string evenly enough for this.
 */
export function traceKept(traceId: string, sampleRate: number): boolean {
  if (sampleRate >= 1) return true
  if (sampleRate <= 0) return false
  let hash = 0x811c9dc5
  for (let index = 0; index < traceId.length; index += 1) {
    hash ^= traceId.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash / 0x100000000 < sampleRate
}

// ── Spans to transactions ─────────────────────────────────────────────────────────────────────────

/** The span a schedule run produces, which becomes a cron check-in rather than a transaction. */
const SCHEDULE_SPAN = 'schedule.run'

/**
 * Group a batch's spans into the transactions they belong to.
 *
 * A *segment root* is a span whose parent is absent, or whose parent is not in this batch. Each one
 * becomes a transaction and every span beneath it becomes an entry in that transaction's `spans[]`.
 * Walking up to find the root is what makes the second case work: a renderer's `command` span may
 * arrive in one batch and the node's request under it in the next, and the second batch still
 * reports a transaction rooted at the request with its own children attached.
 *
 * Holding spans back to wait for a root is refused. That is persistence under another name, and
 * Sentry stitches segments by trace id anyway.
 */
export function groupSpans(spans: Span[]): Array<{ root: Span; children: Span[] }> {
  const byId = new Map<string, Span>()
  for (const span of spans) byId.set(span.spanId, span)

  const rootOf = (span: Span): Span => {
    let current = span
    // Bounded by the group size, because a posted batch can name a parent cycle and nothing upstream
    // of here checks for one.
    for (let hops = 0; hops < byId.size; hops += 1) {
      const parent = current.parentSpanId ? byId.get(current.parentSpanId) : undefined
      if (!parent || parent.traceId !== current.traceId) return current
      current = parent
    }
    return current
  }

  const groups = new Map<string, { root: Span; children: Span[] }>()
  for (const span of spans) {
    const root = rootOf(span)
    const group = groups.get(root.spanId) ?? { root, children: [] }
    if (span.spanId !== root.spanId) group.children.push(span)
    groups.set(root.spanId, group)
  }
  return [...groups.values()]
}

function transactionEnvelope(
  root: Span,
  children: Span[],
  batch: TelemetryBatch,
  options: EnvelopeOptions,
): SentryEnvelope {
  const eventId = options.newId()
  return {
    category: 'transaction',
    header: { event_id: eventId },
    items: [{
      header: { type: 'transaction' },
      payload: {
        event_id: eventId,
        type: 'transaction',
        platform: platformFor(root.attrs),
        transaction: root.name,
        // `custom` says the name came from the code rather than from a URL. It is already a pattern:
        // `http.request` with the route as an attribute, never a hundred URLs
        // (docs/telemetry.md § The admission rule for a span).
        transaction_info: { source: 'custom' },
        start_timestamp: seconds(root.start),
        timestamp: seconds(root.start + root.durationMs),
        contexts: {
          trace: {
            trace_id: root.traceId,
            span_id: root.spanId,
            // Kept when the parent is not in this batch, so the two halves of a trace that crossed a
            // flush window still join up in Sentry.
            ...(root.parentSpanId ? { parent_span_id: root.parentSpanId } : {}),
            op: root.name,
            status: spanStatus(root.status),
          },
        },
        spans: children.map((child) => ({
          span_id: child.spanId,
          trace_id: child.traceId,
          ...(child.parentSpanId ? { parent_span_id: child.parentSpanId } : {}),
          op: child.name,
          description: child.name,
          start_timestamp: seconds(child.start),
          timestamp: seconds(child.start + child.durationMs),
          status: spanStatus(child.status),
          data: child.attrs,
        })),
        tags: tagsFrom(root.attrs),
        server_name: batch.node,
        ...(options.release ? { release: options.release } : {}),
        ...(options.environment ? { environment: options.environment } : {}),
      },
    }],
  }
}

// ── Schedule runs to check-ins ────────────────────────────────────────────────────────────────────

/** Sentry truncates a slug at 50 characters and slugifies the rest server-side. Doing it here means
 *  the exporter knows what the monitor ended up called. */
export function monitorSlug(key: string): string {
  const slug = key.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return (slug || 'schedule').slice(0, 50)
}

const minutes = (ms: number): number => Math.max(1, Math.round(ms / 60_000))

/**
 * The two envelopes one schedule run produces.
 *
 * The exporter only ever sees a finished span, so both go at once: `in_progress` stamped at the
 * span's start, then `ok` or `error` with the duration. They share a `check_in_id`, which is what
 * ties them together, and they are two envelopes rather than one because a `check_in` item may
 * appear at most once per envelope.
 *
 * `monitor_config` rides on the first only, and only when the scheduler reported the cadence.
 * Without it Sentry still records the runs and cannot alert on a missed one, which is the honest
 * outcome for a schedule whose period nobody stated.
 */
function checkInEnvelopes(span: Span, options: EnvelopeOptions): SentryEnvelope[] {
  const key = typeof span.attrs['schedule.key'] === 'string' ? span.attrs['schedule.key'] : span.name
  const checkInId = options.newId()
  const period = span.attrs['schedule.period.ms']
  const timeout = span.attrs['schedule.timeout.ms']
  const config = typeof period === 'number' && period > 0
    ? {
        monitor_config: {
          schedule: { type: 'interval', value: minutes(period), unit: 'minute' },
          checkin_margin: minutes(period),
          ...(typeof timeout === 'number' && timeout > 0 ? { max_runtime: minutes(timeout) } : {}),
        },
      }
    : {}
  const common = {
    check_in_id: checkInId,
    monitor_slug: monitorSlug(key),
    ...(options.environment ? { environment: options.environment } : {}),
    ...(options.release ? { release: options.release } : {}),
    contexts: { trace: { trace_id: span.traceId } },
  }
  const envelope = (payload: Record<string, unknown>): SentryEnvelope => ({
    category: 'monitor',
    header: {},
    items: [{ header: { type: 'check_in' }, payload }],
  })
  return [
    envelope({ ...common, status: 'in_progress', ...config }),
    // Seconds, unlike the two `monitor_config` fields above, which are minutes.
    envelope({ ...common, status: span.status === 'ok' ? 'ok' : 'error', duration: seconds(span.durationMs) }),
  ]
}

// ── Errors to events ──────────────────────────────────────────────────────────────────────────────

/** How many of the batch's events ride on one error as breadcrumbs. */
const MAX_BREADCRUMBS = 20

function errorEnvelope(
  failure: TelemetryFailure,
  events: Event[],
  batch: TelemetryBatch,
  options: EnvelopeOptions,
): SentryEnvelope {
  const eventId = options.newId()
  const frames = options.settings.stacks && failure.stack ? parseStack(failure.stack) : []
  return {
    category: 'error',
    header: { event_id: eventId },
    items: [{
      header: { type: 'event' },
      payload: {
        event_id: eventId,
        timestamp: seconds(failure.at),
        platform: platformFor(failure.attrs),
        level: failure.level,
        // Which package wrote it, which is the question `owner` exists to answer.
        logger: typeof failure.attrs.owner === 'string' ? failure.attrs.owner : 'core',
        exception: {
          values: [{
            type: failure.name,
            value: failure.message,
            // Required, and it must not be `generic`: that spelling is reserved for a call the
            // person made themselves. Every record here came from acorn's own instrumentation.
            mechanism: { type: 'auto.telemetry.acorn', handled: failure.handled },
            ...(frames.length ? { stacktrace: { frames } } : {}),
          }],
        },
        ...(failure.traceId
          ? {
              contexts: {
                trace: {
                  trace_id: failure.traceId,
                  // Sentry requires a span id beside a trace id. A failure raised outside any span
                  // has none, so it names its own, which is what an SDK does for a bare capture.
                  span_id: failure.spanId ?? options.newId().slice(0, 16),
                },
              },
            }
          : {}),
        // Oldest first: Sentry keeps the order it was given rather than sorting by timestamp.
        ...(events.length
          ? {
              breadcrumbs: {
                values: events.slice(-MAX_BREADCRUMBS).map((event) => ({
                  timestamp: seconds(event.at),
                  type: 'default',
                  category: event.name,
                  level: 'info',
                  data: event.attrs,
                })),
              },
            }
          : {}),
        tags: tagsFrom(failure.attrs),
        server_name: batch.node,
        ...(options.release ? { release: options.release } : {}),
        ...(options.environment ? { environment: options.environment } : {}),
      },
    }],
  }
}

// ── Logs and events to log items ──────────────────────────────────────────────────────────────────

/** Sentry's cap. More than this in one item and the item is refused whole. */
const MAX_LOGS_PER_ITEM = 100

type LogEntry = { at: number; level: Log['level']; body: string; attrs: TelemetryAttrs; traceId?: string }

function logEnvelope(entries: LogEntry[], options: EnvelopeOptions, fallbackTraceId: string): SentryEnvelope {
  return {
    category: 'log_item',
    // No `trace` header. A batch mixes traces, and an envelope carrying a dynamic sampling context
    // has to be one trace's.
    header: {},
    items: [{
      header: {
        type: 'log',
        item_count: entries.length,
        content_type: 'application/vnd.sentry.items.log+json',
      },
      payload: {
        items: entries.map((entry) => ({
          timestamp: seconds(entry.at),
          // Required. A line written outside any trace borrows this flush's id rather than being
          // dropped, which keeps one flush's traceless lines together.
          trace_id: entry.traceId ?? fallbackTraceId,
          level: entry.level,
          body: entry.body,
          severity_number: SEVERITY[entry.level],
          attributes: typedAttrs(entry.attrs),
        })),
      },
    }],
  }
}

// ── Metrics to trace metrics ──────────────────────────────────────────────────────────────────────

type MetricEntry = { at: number; name: string; type: 'counter' | 'gauge' | 'distribution'; value: number; unit?: string; attrs: TelemetryAttrs }

/**
 * One acorn metric, as one or four Sentry metrics.
 *
 * A histogram arrives pre-aggregated over a flush window, and sending it as a distribution would
 * mean inventing samples it no longer has. Its four useful numbers go as three gauges and a counter
 * instead, so `sql.select.p95` is a series somebody can chart and `sql.select.count` still adds up.
 */
function metricEntries(metric: Metric): MetricEntry[] {
  const base = { at: metric.at, attrs: metric.attrs, ...(metric.unit ? { unit: metric.unit } : {}) }
  if (typeof metric.value === 'number') {
    return [{ ...base, name: metric.name, type: metric.type === 'count' ? 'counter' : 'gauge', value: metric.value }]
  }
  const histogram = metric.value
  return [
    { ...base, name: `${metric.name}.p50`, type: 'gauge', value: histogram.p50 },
    { ...base, name: `${metric.name}.p95`, type: 'gauge', value: histogram.p95 },
    { ...base, name: `${metric.name}.max`, type: 'gauge', value: histogram.max },
    // No unit. The three above are the histogram's own measure, in milliseconds or whatever it
    // counted; this one is how many samples there were, and labelling it milliseconds would make
    // "120 milliseconds of SQL statements" a chart somebody reads.
    { at: metric.at, attrs: metric.attrs, name: `${metric.name}.count`, type: 'counter', value: histogram.count },
  ]
}

function metricEnvelope(entries: MetricEntry[], fallbackTraceId: string): SentryEnvelope {
  return {
    category: 'trace_metric',
    header: {},
    items: [{
      header: {
        type: 'trace_metric',
        item_count: entries.length,
        // A hyphen here and an underscore in the type above. Sentry's, not a typo.
        content_type: 'application/vnd.sentry.items.trace-metric+json',
      },
      payload: {
        items: entries.map((entry) => ({
          timestamp: seconds(entry.at),
          // Required, and a metric has no trace: a histogram is one row per label set per window,
          // and putting a real trace id in one would mint a series per call
          // (docs/telemetry.md § Ambient attribution).
          trace_id: fallbackTraceId,
          name: entry.name,
          type: entry.type,
          value: entry.value,
          ...(entry.unit ? { unit: entry.unit } : {}),
          attributes: typedAttrs(entry.attrs),
        })),
      },
    }],
  }
}

// ── The whole batch ───────────────────────────────────────────────────────────────────────────────

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size))
  return out
}

/**
 * Everything one batch becomes.
 *
 * The order is the order it goes on the wire: errors first, because an issue is the thing somebody
 * is waiting for; then transactions and check-ins; then the batched logs and metrics, which are the
 * cheapest to lose if the queue is already full.
 */
export function buildEnvelopes(batch: TelemetryBatch, options: EnvelopeOptions): SentryEnvelope[] {
  const { kinds } = options.settings
  const fallbackTraceId = options.newId()
  const envelopes: SentryEnvelope[] = []

  const spans: Span[] = []
  const logs: Log[] = []
  const events: Event[] = []
  const metrics: Metric[] = []
  const failures: TelemetryFailure[] = []
  for (const record of batch.records) {
    if (record.kind === 'span') spans.push(record)
    else if (record.kind === 'log') logs.push(record)
    else if (record.kind === 'event') events.push(record)
    else if (record.kind === 'metric') metrics.push(record)
    else failures.push(record)
  }

  if (kinds.error) {
    for (const failure of failures) {
      // Sentry has no standalone event item, so an acorn event is drawn as the breadcrumb trail on
      // the failure that followed it. The record model carries no trace on an event, so "before this
      // one, in this flush window" is as close as the trail can honestly get.
      const before = kinds.event ? events.filter((event) => event.at <= failure.at) : []
      envelopes.push(errorEnvelope(failure, before, batch, options))
    }
  }

  if (kinds.span) {
    const checkIns = spans.filter((span) => span.name === SCHEDULE_SPAN)
    const traced = spans.filter((span) => span.name !== SCHEDULE_SPAN && traceKept(span.traceId, options.settings.sampleRate))
    for (const { root, children } of groupSpans(traced)) {
      envelopes.push(transactionEnvelope(root, children, batch, options))
    }
    // Never sampled. A check-in dropped by a dice roll is a monitor that reports a missed run.
    for (const span of checkIns) envelopes.push(...checkInEnvelopes(span, options))
  }

  const entries: LogEntry[] = []
  if (kinds.log) {
    for (const log of logs) {
      entries.push({ at: log.at, level: log.level, body: log.body, attrs: { ...log.attrs, logger: log.logger }, ...(log.traceId ? { traceId: log.traceId } : {}) })
    }
  }
  if (kinds.event) {
    // Also a log line, not only a breadcrumb: a breadcrumb is only ever seen next to an error, and
    // an event that never preceded one would otherwise leave no trace at all.
    for (const event of events) {
      entries.push({ at: event.at, level: 'info', body: event.name, attrs: event.attrs })
    }
  }
  entries.sort((left, right) => left.at - right.at)
  for (const page of chunk(entries, MAX_LOGS_PER_ITEM)) envelopes.push(logEnvelope(page, options, fallbackTraceId))

  if (kinds.metric) {
    const measurements = metrics.flatMap(metricEntries)
    for (const page of chunk(measurements, MAX_LOGS_PER_ITEM)) envelopes.push(metricEnvelope(page, fallbackTraceId))
  }

  return envelopes
}

/**
 * An envelope with a header and no items.
 *
 * What `validate` and `test` post to prove the DSN names a project this machine can reach. Sentry
 * accepts it, stores nothing, and answers 200, so a connection test costs the owner no quota and
 * puts no fabricated event in their issue list.
 */
export const probeEnvelope = (): SentryEnvelope => ({ category: 'log_item', header: {}, items: [] })

/**
 * The wire bytes: one JSON object per line, the envelope header first.
 *
 * Every item declares its `length` in bytes. The specification lets it be omitted and infers the
 * payload's end from the next newline, which is correct until a payload contains one; declaring it
 * costs nothing and removes the class of bug where an escaped string changes how the rest of the
 * envelope parses.
 */
export function serializeEnvelope(envelope: SentryEnvelope, header: Record<string, unknown>): string {
  const encoder = new TextEncoder()
  const lines = [JSON.stringify({ ...header, ...envelope.header })]
  for (const item of envelope.items) {
    const payload = JSON.stringify(item.payload)
    lines.push(JSON.stringify({ ...item.header, length: encoder.encode(payload).byteLength }))
    lines.push(payload)
  }
  return `${lines.join('\n')}\n`
}
