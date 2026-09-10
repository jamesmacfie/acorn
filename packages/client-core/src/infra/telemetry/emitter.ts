// The client's telemetry emitter: the same five record kinds and the same verbs as the node's
// collector, and one thing the node does not have, a trace that spans an interaction.
//
// docs/telemetry.md owns the model and docs/frontend.md § Telemetry owns what the renderer measures.
// Three shape decisions belong here.
//
// **The verbs match the node's, argument for argument.** `measure`, `recordDuration`, `startSpan`
// and the four emits all take the owner first, exactly as `node-core/server/telemetry/collector.ts`
// does. The terminal client reuses this file and changes only the poster, so a second copy of the
// verbs would be two vocabularies for one record model. The desktop helper reuses the node's
// collector instead, because it is a Node process that already depends on node-core and cannot
// reach a package that draws (docs/shell.md § What the helper reports).
//
// **There is no scrubber here.** A browser cannot know this machine's home directory or its data
// root, which are the two prefixes worth collapsing, so the node re-scrubs every posted record at
// the door (`ingestTelemetry`). One scrubber, in the process that knows the paths.
//
// **The interaction trace is a module variable, not an async context.** A command or a page change
// opens one; every request `apiClient.send()` makes while it is open hangs under it, so the node's
// `http.request` span is a child of the click that caused it. Work that continues after the span
// ends gets no parent. That is a known imprecision, and it is written down rather than fixed with
// an async-context polyfill the renderer does not have.
//
// Nothing here can fail the thing it measures. Every verb is wrapped and every verb starts with one
// boolean read.
import type {
  TelemetryAttrs,
  TelemetryLog,
  TelemetryMetric,
  TelemetryRecord,
  TelemetrySpan,
  PostedTelemetryRuntime,
} from '@acorn/protocol/telemetry.ts'
import { ATTRS_MAX, ATTR_KEY_MAX, ATTR_VALUE_MAX, LOG_BODY_MAX, formatTraceparent } from '@acorn/protocol/telemetry.ts'
import { setContributionErrorHandler } from '../../kit/lib/contributionErrors'
import { telemetryQueue, type TelemetryQueue } from './queue'

/** Same numbers as the node's collector, for the same reasons: enough that a burst survives one
 *  window, small enough that a flush is one modest request. */
const FLUSH_AT = 500
const FLUSH_EVERY_MS = 5_000
const MAX_SAMPLES = 20_000
/** How many label sets one window may hold, the node's number for the node's reason: a label whose
 *  value varies per call would otherwise mint one series per call, which is the cardinality failure
 *  the vocabulary rule exists to prevent (docs/telemetry.md § The attribute vocabulary). */
const MAX_SERIES = 200

export type TelemetryPoster = (records: readonly TelemetryRecord[]) => Promise<void>

export type SpanInput = { name: string; attrs?: TelemetryAttrs; traceId?: string; parentSpanId?: string }
export type SpanHandle = {
  readonly traceId: string
  readonly spanId: string
  end(status?: 'ok' | 'error', attrs?: TelemetryAttrs): void
}
export type ErrorInput = {
  name: string
  message?: string
  stack?: string
  level?: 'error' | 'fatal'
  handled?: boolean
  attrs?: TelemetryAttrs
  traceId?: string
  spanId?: string
}

type Histogram = { count: number; sum: number; min: number; max: number; samples: number[] }

type EmitterState = {
  runtime: PostedTelemetryRuntime
  enabled: boolean
  queue: TelemetryQueue
  histograms: Map<string, { owner: string; seam: string; attrs: TelemetryAttrs; histogram: Histogram }>
  post: TelemetryPoster | null
  timer: ReturnType<typeof setInterval> | null
  posting: boolean
  trace: { traceId: string; spanId: string } | null
  truncated: number
  generation: number
}

const state: EmitterState = {
  runtime: 'renderer',
  enabled: false,
  queue: telemetryQueue(),
  histograms: new Map(),
  post: null,
  timer: null,
  posting: false,
  trace: null,
  truncated: 0,
  generation: 0,
}

/** The one boolean read every verb below starts with. Off means no record is built at all. */
export const telemetryEnabled = (): boolean => state.enabled

/**
 * Turn collection on or off.
 *
 * The node owns the switch, so this is called from whatever watches the `telemetry.enabled`
 * preference: on the desktop that is one effect over the prefs query in `App.tsx`. Turning it off
 * throws away what is held, because those records describe a session the owner has said they do not
 * want reported.
 */
export function setTelemetryEnabled(on: boolean): void {
  if (state.enabled === on) return
  state.generation += 1
  state.enabled = on
  if (on) return arm()
  disarm()
  state.queue.take()
  state.histograms.clear()
  state.trace = null
}

// ── Attribute hygiene ─────────────────────────────────────────────────────────────────────────────
//
// The same caps the node applies, applied here as well so a batch stays small enough to be accepted:
// the route refuses a body over a mebibyte whole, and 500 records with an unbounded string on each
// is how that happens. The node re-applies them on ingest, which is what makes them a rule rather
// than a courtesy.

function cleanAttrs(attrs: TelemetryAttrs | undefined, owner: string): TelemetryAttrs {
  const out: TelemetryAttrs = {}
  let count = 0
  for (const [key, value] of Object.entries(attrs ?? {})) {
    // `owner` and `runtime` are the host's to stamp. An emitter that sets one is ignored rather than
    // refused, the same rule the node's collector follows.
    if (key === 'owner' || key === 'runtime') continue
    if (count >= ATTRS_MAX) {
      state.truncated += 1
      break
    }
    if (value === undefined) continue
    const short = key.length > ATTR_KEY_MAX ? key.slice(0, ATTR_KEY_MAX) : key
    if (typeof value === 'string') {
      if (value.length > ATTR_VALUE_MAX) state.truncated += 1
      out[short] = value.slice(0, ATTR_VALUE_MAX)
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      out[short] = value
    } else {
      state.truncated += 1
      continue
    }
    count += 1
  }
  out.owner = owner
  out.runtime = state.runtime
  return out
}

/** Every verb goes through this. A throw inside instrumentation must never reach the code being
 *  instrumented. */
function safely(run: () => void): void {
  try {
    run()
  } catch {
    // Deliberately silent. Reporting a telemetry failure through the logger would call back in here.
  }
}

function push(record: TelemetryRecord): void {
  state.queue.push(record)
  if (state.queue.size() >= FLUSH_AT) queueMicrotask(() => void flushTelemetry())
}

// ── Ids ───────────────────────────────────────────────────────────────────────────────────────────
//
// W3C sizes, lowercase hex, so an id goes into a `traceparent` header untouched. `Math.random`
// rather than `crypto`: a trace id is a correlation key and not a secret, and this runs on the click
// path.

const hex = (bytes: number): string => {
  let out = ''
  for (let index = 0; index < bytes; index += 1) out += Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
  return out
}
export const newTraceId = (): string => hex(16)
export const newSpanId = (): string => hex(8)

// ── The interaction trace ─────────────────────────────────────────────────────────────────────────

/** The span every request made right now should hang under, or null between interactions. */
export const currentTrace = (): { traceId: string; spanId: string } | null => state.trace

/** The `traceparent` header value for the open interaction, or nothing when there is none. A request
 *  outside an interaction starts its own trace on the node rather than joining a stale one. */
export const currentTraceparent = (): string | undefined =>
  state.trace ? formatTraceparent(state.trace.traceId, state.trace.spanId) : undefined

/**
 * Open a span and make it the parent of everything the renderer does until it ends.
 *
 * Two seams call this: `executeCommand` and the page-change wrapper. A second interaction opening
 * over the first replaces it, which is what a person clicking twice looks like, and ending an
 * interaction that is no longer the current one leaves the current one alone.
 */
export function startInteraction(owner: string, input: SpanInput): SpanHandle {
  if (!telemetryEnabled()) return INERT
  const span = startSpan(owner, { ...input, traceId: input.traceId ?? newTraceId() })
  state.trace = { traceId: span.traceId, spanId: span.spanId }
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    end: (status, attrs) => {
      span.end(status, attrs)
      // Only if it is still ours. A second interaction that opened over this one owns the trace now,
      // and clearing it here would orphan every request the newer one is about to make.
      if (state.trace?.spanId === span.spanId) state.trace = null
    },
  }
}

// ── The emit verbs ────────────────────────────────────────────────────────────────────────────────

export function emitSpan(owner: string, span: Omit<TelemetrySpan, 'kind' | 'attrs'> & { attrs?: TelemetryAttrs }): void {
  if (!telemetryEnabled()) return
  safely(() => push({ ...span, kind: 'span', attrs: cleanAttrs(span.attrs, owner) }))
}

export function emitLog(owner: string, log: Omit<TelemetryLog, 'kind' | 'attrs'> & { attrs?: TelemetryAttrs }): void {
  if (!telemetryEnabled()) return
  safely(() => push({ ...log, kind: 'log', body: log.body.slice(0, LOG_BODY_MAX), attrs: cleanAttrs(log.attrs, owner) }))
}

export function emitEvent(owner: string, name: string, attrs?: TelemetryAttrs): void {
  if (!telemetryEnabled()) return
  safely(() => push({ kind: 'event', at: Date.now(), name, attrs: cleanAttrs(attrs, owner) }))
}

export function emitMetric(owner: string, metric: Omit<TelemetryMetric, 'kind' | 'at' | 'attrs'> & { at?: number; attrs?: TelemetryAttrs }): void {
  if (!telemetryEnabled()) return
  safely(() => push({ ...metric, kind: 'metric', at: metric.at ?? Date.now(), attrs: cleanAttrs(metric.attrs, owner) }))
}

export function emitError(owner: string, error: ErrorInput): void {
  if (!telemetryEnabled()) return
  safely(() =>
    push({
      kind: 'error',
      at: Date.now(),
      name: error.name,
      message: error.message ?? '',
      ...(error.stack ? { stack: error.stack } : {}),
      level: error.level ?? 'error',
      handled: error.handled ?? true,
      ...(error.traceId ? { traceId: error.traceId } : {}),
      ...(error.spanId ? { spanId: error.spanId } : {}),
      attrs: cleanAttrs(error.attrs, owner),
    }),
  )
}

/** An inert handle when telemetry is off, so a caller writes the same three lines either way. */
const INERT: SpanHandle = { traceId: '', spanId: '', end: () => {} }

export function startSpan(owner: string, input: SpanInput): SpanHandle {
  if (!telemetryEnabled()) return INERT
  const traceId = input.traceId ?? state.trace?.traceId ?? newTraceId()
  // A span with no stated parent hangs under the open interaction, which is what makes one click
  // one trace without every seam passing the parent along by hand.
  const parentSpanId = input.parentSpanId ?? (input.traceId ? undefined : state.trace?.spanId)
  const spanId = newSpanId()
  const started = Date.now()
  const from = performance.now()
  let ended = false
  return {
    traceId,
    spanId,
    end: (status = 'ok', attrs) => {
      if (ended) return
      ended = true
      emitSpan(owner, {
        traceId,
        spanId,
        ...(parentSpanId ? { parentSpanId } : {}),
        name: input.name,
        start: started,
        durationMs: performance.now() - from,
        status,
        attrs: { ...input.attrs, ...attrs },
      })
    },
  }
}

/** One histogram per owner, seam and label set, so two samples share a row only when all three
 *  match. Sorted, because two call sites can build the same attributes in a different order and a
 *  metrics backend counts those as one series. Empty for the common case of none. */
function labelsOf(attrs: TelemetryAttrs | undefined): string {
  if (!attrs) return ''
  const keys = Object.keys(attrs).sort()
  if (keys.length === 0) return ''
  return keys.map((key) => `${key}=${String(attrs[key])}`).join('\u0000')
}

/** One sample into a histogram, aggregated over the flush window. What a seam past about ten a
 *  second uses instead of a span (docs/telemetry.md § Hot seams are metrics). */
export function recordDuration(owner: string, seam: string, ms: number, attrs?: TelemetryAttrs): void {
  if (!telemetryEnabled()) return
  safely(() => {
    // Keyed by owner, seam and attributes together, which is the node's key for the node's reason: a
    // histogram describes one label set, and merging two of them under whichever arrived first
    // reports one pane's name for every pane's timings. The terminal client's `tui.frame` carries a
    // phase and its `tui.key` carries a reason, so this is the difference between four rows and one
    // wrong one.
    const labels = labelsOf(attrs)
    let key = `${owner}\u0000${seam}\u0000${labels}`
    let slot = state.histograms.get(key)
    if (!slot && labels && state.histograms.size >= MAX_SERIES) {
      // At the cap a sample keeps its count and loses its labels rather than being dropped: the
      // totals stay exact, memory stays bounded, and the truncation counter says it happened.
      state.truncated += 1
      attrs = undefined
      key = `${owner}\u0000${seam}\u0000`
      slot = state.histograms.get(key)
    }
    if (!slot) {
      slot = { owner, seam, attrs: { ...attrs, seam }, histogram: { count: 0, sum: 0, min: ms, max: ms, samples: [] } }
      state.histograms.set(key, slot)
    }
    const h = slot.histogram
    h.count += 1
    h.sum += ms
    h.min = Math.min(h.min, ms)
    h.max = Math.max(h.max, ms)
    if (h.samples.length < MAX_SAMPLES) h.samples.push(ms)
  })
}

/** Time one call and hand back its own result untouched. Promise-aware, and timed to settlement. */
export function measure<T>(owner: string, seam: string, run: () => T, attrs?: TelemetryAttrs): T {
  if (!telemetryEnabled()) return run()
  const from = performance.now()
  const finish = () => recordDuration(owner, seam, performance.now() - from, attrs)
  let result: T
  try {
    result = run()
  } catch (error) {
    finish()
    throw error
  }
  // `finally` rather than `then`, so a rejection is still counted.
  if (result instanceof Promise) return result.finally(finish) as T
  finish()
  return result
}

// ── Flush ─────────────────────────────────────────────────────────────────────────────────────────

function foldHistograms(): void {
  if (state.histograms.size === 0) return
  const at = Date.now()
  for (const slot of state.histograms.values()) {
    const h = slot.histogram
    const sorted = [...h.samples].sort((a, b) => a - b)
    const percentile = (fraction: number) =>
      sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
    state.queue.push({
      kind: 'metric',
      at,
      name: slot.seam,
      type: 'histogram',
      value: { count: h.count, sum: h.sum, min: h.min, max: h.max, p50: percentile(0.5), p95: percentile(0.95) },
      unit: 'ms',
      attrs: cleanAttrs(slot.attrs, slot.owner),
    })
  }
  state.histograms.clear()
}

/**
 * Fold the histograms, post everything held, and put it back if the post failed.
 *
 * One post at a time. A second flush while the first is in flight would post the same window twice
 * on a slow node, and skipping is free: the next tick is five seconds away.
 */
export async function flushTelemetry(): Promise<void> {
  if (!state.enabled || state.posting) return
  safely(foldHistograms)
  const dropped = state.queue.takeDropped()
  if (dropped > 0) {
    state.queue.push({ kind: 'metric', at: Date.now(), name: 'telemetry.dropped', type: 'count', value: dropped, attrs: cleanAttrs({}, 'core') })
  }
  if (state.truncated > 0) {
    const truncated = state.truncated
    state.truncated = 0
    state.queue.push({ kind: 'metric', at: Date.now(), name: 'telemetry.truncated', type: 'count', value: truncated, attrs: cleanAttrs({}, 'core') })
  }
  const post = state.post
  if (!post || state.queue.size() === 0) return
  const generation = state.generation
  const records = state.queue.take()
  state.posting = true
  try {
    await post(records)
  } catch {
    // The node is offline, restarting, or refusing. Keep the records: the queue's cap is what stops
    // an unreachable node turning into an unbounded buffer.
    if (state.enabled && generation === state.generation) state.queue.putBack(records)
  } finally {
    state.posting = false
  }
}

function arm(): void {
  if (state.timer) return
  state.timer = setInterval(() => void flushTelemetry(), FLUSH_EVERY_MS)
}

function disarm(): void {
  if (!state.timer) return
  clearInterval(state.timer)
  state.timer = null
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────────────────────────

export type StartTelemetryOptions = {
  /** Which runtime this is. Stamped onto every record and named again on the batch, so the node can
   *  refuse a batch that claims to be its own process. */
  runtime: PostedTelemetryRuntime
  /** How a batch leaves. Passed in rather than imported, so this module never reaches the API client
   *  and the terminal client can post its batches its own way. */
  post: TelemetryPoster
}

/** Called once from the client composition root, before anything renders. Collection still waits on
 *  `setTelemetryEnabled`, which the preference drives. */
export function startClientTelemetry(options: StartTelemetryOptions): void {
  state.runtime = options.runtime
  state.post = options.post
  // A contribution that throws while rendering, reported through the seam `kit/` has for it
  // (kit/lib/contributionErrors.ts). Installed here rather than imported there, because `kit/` may
  // not import this module and a plugin's UI bundle re-exports `kit/`.
  setContributionErrorHandler(({ contributionId, owner, error }) => {
    emitError(owner ?? 'core', {
      name: error instanceof Error ? error.name || 'Error' : 'Error',
      message: error instanceof Error ? error.message : String(error),
      handled: true,
      attrs: { seam: 'contribution.render', 'contribution.id': contributionId },
    })
  })
  if (state.enabled) arm()
}

/** Test seam: forget the poster, the queue and the open trace. */
export function _resetClientTelemetry(): void {
  setContributionErrorHandler(null)
  disarm()
  state.generation += 1
  state.enabled = false
  state.post = null
  state.posting = false
  state.queue = telemetryQueue()
  state.histograms.clear()
  state.trace = null
  state.truncated = 0
  state.runtime = 'renderer'
}

// ── The owner-bound projection ────────────────────────────────────────────────────────────────────

/** What a compiled client plugin holds, and the same six verbs the node's `ctx.telemetry` has
 *  (node-core/server/telemetry/collector.ts). One vocabulary across both halves, so an author who
 *  learned one does not get the other backwards. */
export type PluginTelemetry = {
  event(name: string, attrs?: TelemetryAttrs): void
  count(name: string, value?: number, attrs?: TelemetryAttrs): void
  gauge(name: string, value: number, attrs?: TelemetryAttrs): void
  error(error: ErrorInput): void
  /** Time one call and return its own result untouched. Promise-aware. */
  measure<T>(name: string, run: () => T, attrs?: TelemetryAttrs): T
  /** For work whose start and end do not fit one closure. `end` is idempotent, and the span hangs
   *  under whatever interaction is open. */
  startSpan(name: string, options?: { attrs?: TelemetryAttrs; traceId?: string; parentSpanId?: string }): SpanHandle
}

/**
 * The verbs with one owner closed over, for a plugin whose client half runs in this process.
 *
 * The client has no `ctx.telemetry` to bind: a compiled client plugin's context is contribution
 * points and nothing else, and its `init` is the only place its own id is in hand. So the id is the
 * argument here, and it is the id `makeContext` has already checked against every contribution the
 * plugin registers (host/registries/extensionPoints/plugin.ts).
 *
 * A sandboxed frame is the other half of the same question and gets a different answer, because it
 * is not in this process: it posts a record over the bridge and the host stamps the owner from the
 * binding (host/frames/frameTelemetry.ts).
 */
export const telemetryFor = (owner: string): PluginTelemetry => ({
  event: (name, attrs) => emitEvent(owner, name, attrs),
  count: (name, value = 1, attrs) => emitMetric(owner, { name, type: 'count', value, ...(attrs ? { attrs } : {}) }),
  gauge: (name, value, attrs) => emitMetric(owner, { name, type: 'gauge', value, ...(attrs ? { attrs } : {}) }),
  error: (error) => emitError(owner, error),
  measure: (name, run, attrs) => measure(owner, name, run, attrs),
  startSpan: (name, options) => startSpan(owner, { name, ...options }),
})
