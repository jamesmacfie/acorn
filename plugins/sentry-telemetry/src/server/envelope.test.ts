import type { TelemetryBatch, TelemetryRecord } from '@acorn/protocol/telemetry.ts'
import { describe, expect, it } from 'vitest'
import { buildEnvelopes, groupSpans, monitorSlug, probeEnvelope, sentrySpans, serializeEnvelope, traceKept, type EnvelopeOptions } from './envelope'
import { DEFAULT_SETTINGS } from '../shared/settings'

const TRACE = 'a'.repeat(32)
const OTHER_TRACE = 'b'.repeat(32)
const hex16 = (seed: string) => seed.repeat(16).slice(0, 16)

const batchOf = (records: TelemetryRecord[]): TelemetryBatch => ({ node: 'node-1', version: '0.1.0', records })

// Ids are the one thing a test cannot match, so it supplies them: `id-1`, `id-2`, in call order.
const options = (overrides: Partial<EnvelopeOptions> = {}): EnvelopeOptions => {
  let next = 0
  return {
    settings: DEFAULT_SETTINGS,
    environment: 'development',
    release: 'acorn@0.1.0',
    newId: () => `id-${(next += 1)}`,
    ...overrides,
  }
}

const span = (
  over: Partial<Extract<TelemetryRecord, { kind: 'span' }>> = {},
): Extract<TelemetryRecord, { kind: 'span' }> => ({
  kind: 'span',
  traceId: TRACE,
  spanId: hex16('1'),
  name: 'http.request',
  start: 1_700_000_000_000,
  durationMs: 250,
  status: 'ok',
  attrs: { owner: 'core', runtime: 'node', seam: 'http.request', route: '/v2/core/tasks/:id' },
  ...over,
})

const payloadOf = (envelope: { items: Array<{ payload: unknown }> }) => envelope.items[0].payload as Record<string, any>

describe('errors', () => {
  const failure: TelemetryRecord = {
    kind: 'error',
    at: 1_700_000_000_000,
    name: 'TypeError',
    message: 'cannot read a property of undefined',
    stack: 'TypeError: boom\n    at refresh (<data>/plugins/github/dist/node.js:1:2)',
    level: 'error',
    handled: false,
    traceId: TRACE,
    spanId: hex16('1'),
    attrs: { owner: 'github', runtime: 'node', 'task.id': 'task-7' },
  }

  it('becomes one event envelope with an exception and a trace', () => {
    const [envelope, ...rest] = buildEnvelopes(batchOf([failure]), options())
    expect(rest).toEqual([])
    expect(envelope.category).toBe('error')
    // Sentry reads the envelope-level `event_id` first, so the two have to agree.
    expect(envelope.header.event_id).toBe('id-2')
    expect(envelope.items[0].header).toEqual({ type: 'event' })

    const payload = payloadOf(envelope)
    expect(payload).toMatchObject({
      event_id: 'id-2',
      timestamp: 1_700_000_000,
      platform: 'node',
      level: 'error',
      logger: 'github',
      server_name: 'node-1',
      environment: 'development',
      release: 'acorn@0.1.0',
      contexts: { trace: { trace_id: TRACE, span_id: hex16('1') } },
      tags: { owner: 'github', runtime: 'node', 'task.id': 'task-7' },
    })
    expect(payload.exception.values[0]).toMatchObject({
      type: 'TypeError',
      value: 'cannot read a property of undefined',
      // Required by the protocol, and it must not be `generic`: that spelling means a person called
      // `captureException` themselves.
      mechanism: { type: 'auto.telemetry.acorn', handled: false },
    })
    expect(payload.exception.values[0].stacktrace.frames).toHaveLength(1)
  })

  it('leaves the stack off when the owner turned stacks off', () => {
    const settings = { ...DEFAULT_SETTINGS, stacks: false }
    // The record still carries one here; `redactRecord` is what strips it, and the builder simply
    // does not read it.
    const [envelope] = buildEnvelopes(batchOf([failure]), options({ settings }))
    expect(payloadOf(envelope).exception.values[0].stacktrace).toBeUndefined()
  })

  it('carries the events that preceded it as breadcrumbs', () => {
    const before: TelemetryRecord = { kind: 'event', at: failure.at - 10, name: 'ws.shed', attrs: { channel: 'tasks' } }
    const after: TelemetryRecord = { kind: 'event', at: failure.at + 10, name: 'ws.reconnect', attrs: {} }
    const [envelope] = buildEnvelopes(batchOf([before, failure, after]), options())
    const crumbs = payloadOf(envelope).breadcrumbs.values as Array<Record<string, unknown>>
    expect(crumbs).toHaveLength(1)
    expect(crumbs[0]).toMatchObject({ category: 'ws.shed', level: 'info', data: { channel: 'tasks' } })
  })

  it('sends nothing when errors are switched off', () => {
    const settings = { ...DEFAULT_SETTINGS, kinds: { ...DEFAULT_SETTINGS.kinds, error: false } }
    expect(buildEnvelopes(batchOf([failure]), options({ settings }))).toEqual([])
  })
})

describe('spans', () => {
  it('makes one transaction out of a root and its two children', () => {
    const root = span({ spanId: hex16('1'), name: 'command' })
    const first = span({ spanId: hex16('2'), parentSpanId: hex16('1'), name: 'api.request', durationMs: 40 })
    const second = span({ spanId: hex16('3'), parentSpanId: hex16('2'), name: 'http.request', durationMs: 20 })

    const envelopes = buildEnvelopes(batchOf([first, root, second]), options())
    expect(envelopes).toHaveLength(1)
    expect(envelopes[0].category).toBe('transaction')
    const payload = payloadOf(envelopes[0])
    expect(payload).toMatchObject({
      type: 'transaction',
      transaction: 'command',
      start_timestamp: 1_700_000_000,
      timestamp: 1_700_000_000.25,
      contexts: { trace: { trace_id: TRACE, span_id: hex16('1'), op: 'command', status: 'ok' } },
    })
    expect(payload.spans).toHaveLength(2)
    expect(payload.spans.map((child: Record<string, unknown>) => child.op)).toEqual(['api.request', 'http.request'])
    expect(payload.spans[1]).toMatchObject({ parent_span_id: hex16('2'), timestamp: 1_700_000_000.02 })
  })

  it('sends a span whose parent is in another batch as its own transaction, still naming the parent', () => {
    // Sentry stitches the two halves by trace id. Holding the child back to wait for a root is the
    // persistence this programme refuses.
    const orphan = span({ spanId: hex16('4'), parentSpanId: hex16('9'), name: 'http.request' })
    const [envelope] = buildEnvelopes(batchOf([orphan]), options())
    expect(payloadOf(envelope).contexts.trace).toMatchObject({ span_id: hex16('4'), parent_span_id: hex16('9') })
    expect(payloadOf(envelope).spans).toEqual([])
  })

  it('keeps two traces apart', () => {
    const envelopes = buildEnvelopes(batchOf([span(), span({ traceId: OTHER_TRACE, spanId: hex16('2') })]), options())
    expect(envelopes).toHaveLength(2)
  })

  it('reports a failed span as internal_error, which is what Sentry calls a generic failure', () => {
    const [envelope] = buildEnvelopes(batchOf([span({ status: 'error' })]), options())
    expect(payloadOf(envelope).contexts.trace.status).toBe('internal_error')
  })

  it('drops a whole trace when sampling says so, and keeps the check-ins', () => {
    const settings = { ...DEFAULT_SETTINGS, sampleRate: 0 }
    const run = span({ name: 'schedule.run', attrs: { owner: 'core', 'schedule.key': 'core:audit-prune' } })
    const envelopes = buildEnvelopes(batchOf([span(), run]), options({ settings }))
    expect(envelopes.map((envelope) => envelope.category)).toEqual(['monitor', 'monitor'])
  })

  it('drops routine request-only traces but keeps slow, failed, and interaction request spans', () => {
    const routineApi = span({ spanId: hex16('1'), name: 'api.request', durationMs: 80 })
    const routineHttp = span({ spanId: hex16('2'), name: 'http.request', durationMs: 20 })
    const slowApi = span({ traceId: OTHER_TRACE, spanId: hex16('3'), name: 'api.request', durationMs: 1_001 })
    const failedHttp = span({ traceId: 'c'.repeat(32), spanId: hex16('4'), status: 'error', durationMs: 5 })
    const command = span({ traceId: 'd'.repeat(32), spanId: hex16('5'), name: 'command' })
    const commandRequest = span({ traceId: command.traceId, spanId: hex16('6'), name: 'api.request', durationMs: 5 })

    expect(sentrySpans([routineApi, routineHttp, slowApi, failedHttp, command, commandRequest] as never))
      .toEqual([slowApi, failedHttp, command, commandRequest])
  })

  it('never exports successful telemetry and preference request spans', () => {
    const telemetry = span({ name: 'http.request', durationMs: 5_000, attrs: { route: '/v2/core/telemetry' } })
    const prefs = span({ spanId: hex16('2'), name: 'http.request', durationMs: 5_000, attrs: { route: '/v2/core/prefs' } })
    const failed = span({ spanId: hex16('3'), name: 'http.request', status: 'error', attrs: { route: '/v2/core/telemetry' } })
    expect(sentrySpans([telemetry, prefs, failed] as never)).toEqual([failed])
  })
})

describe('groupSpans', () => {
  it('terminates on a parent cycle instead of walking it forever', () => {
    // A batch posted by another runtime is caller-controlled input and nothing upstream checks
    // this, so the walk is bounded. What it produces for a cycle does not matter; that it produces
    // something, once per span, does.
    const left = span({ spanId: hex16('1'), parentSpanId: hex16('2') })
    const right = span({ spanId: hex16('2'), parentSpanId: hex16('1') })
    const groups = groupSpans([left, right] as never)
    const placed = groups.flatMap((group) => [group.root.spanId, ...group.children.map((child) => child.spanId)])
    expect(placed.sort()).toEqual([hex16('1'), hex16('2')])
  })
})

describe('traceKept', () => {
  it('keeps everything at 1 and nothing at 0', () => {
    expect(traceKept(TRACE, 1)).toBe(true)
    expect(traceKept(TRACE, 0)).toBe(false)
  })

  it('decides the same trace the same way twice, so a transaction keeps its own spans', () => {
    expect(traceKept(TRACE, 0.5)).toBe(traceKept(TRACE, 0.5))
  })

  it('spreads roughly evenly over many ids', () => {
    const ids = Array.from({ length: 2_000 }, (_, index) => index.toString(16).padStart(32, '0'))
    const kept = ids.filter((id) => traceKept(id, 0.25)).length
    expect(kept / ids.length).toBeGreaterThan(0.2)
    expect(kept / ids.length).toBeLessThan(0.3)
  })
})

describe('check-ins', () => {
  const run = span({
    name: 'schedule.run',
    durationMs: 4_000,
    attrs: {
      owner: 'github',
      'schedule.key': 'github:refresh',
      'schedule.reason': 'due',
      'schedule.period.ms': 300_000,
      'schedule.timeout.ms': 120_000,
    },
  })

  it('sends the pair as two envelopes sharing one id', () => {
    // A `check_in` item may appear at most once per envelope, so the in-progress and the outcome
    // cannot ride together however convenient that would be.
    const envelopes = buildEnvelopes(batchOf([run]), options())
    expect(envelopes.map((envelope) => envelope.category)).toEqual(['monitor', 'monitor'])
    const [started, finished] = envelopes.map(payloadOf)
    expect(started.check_in_id).toBe(finished.check_in_id)
    expect(started).toMatchObject({ monitor_slug: 'github-refresh', status: 'in_progress', environment: 'development' })
    // Seconds, while `monitor_config` below is minutes.
    expect(finished).toMatchObject({ status: 'ok', duration: 4 })
    expect(finished.monitor_config).toBeUndefined()
  })

  it('describes the schedule from what the scheduler reported', () => {
    const [started] = buildEnvelopes(batchOf([run]), options())
    expect(payloadOf(started).monitor_config).toEqual({
      schedule: { type: 'interval', value: 5, unit: 'minute' },
      checkin_margin: 5,
      max_runtime: 2,
    })
  })

  it('leaves the schedule out when the run did not report a period', () => {
    const bare = span({ name: 'schedule.run', attrs: { owner: 'core', 'schedule.key': 'core:audit-prune' } })
    const [started] = buildEnvelopes(batchOf([bare]), options())
    expect(payloadOf(started).monitor_config).toBeUndefined()
  })

  it('reports a failed run as error', () => {
    const [, finished] = buildEnvelopes(batchOf([span({ name: 'schedule.run', status: 'error', attrs: { 'schedule.key': 'a:b' } })]), options())
    expect(payloadOf(finished).status).toBe('error')
  })
})

describe('monitorSlug', () => {
  it('turns a schedule key into a slug Sentry keeps', () => {
    expect(monitorSlug('github:refresh')).toBe('github-refresh')
    expect(monitorSlug('Core:Audit Prune')).toBe('core-audit-prune')
  })

  it('cuts at the 50 characters Sentry truncates to, so this side knows the name', () => {
    expect(monitorSlug('x'.repeat(80))).toHaveLength(50)
  })

  it('never answers empty', () => {
    expect(monitorSlug(':::')).toBe('schedule')
  })
})

describe('logs and events', () => {
  const line = (at: number, over: Partial<Extract<TelemetryRecord, { kind: 'log' }>> = {}): TelemetryRecord => ({
    kind: 'log',
    at,
    level: 'warn',
    logger: 'schedules',
    body: 'github:refresh timed out',
    attrs: { owner: 'core', runtime: 'node', attempts: 3, retried: true },
    traceId: TRACE,
    ...over,
  })

  it('batches into one log item with the content type Sentry requires', () => {
    const envelopes = buildEnvelopes(batchOf([line(1_700_000_000_000)]), options())
    expect(envelopes).toHaveLength(1)
    expect(envelopes[0].category).toBe('log_item')
    expect(envelopes[0].items[0].header).toEqual({
      type: 'log',
      item_count: 1,
      content_type: 'application/vnd.sentry.items.log+json',
    })
    const entry = (payloadOf(envelopes[0]).items as Array<Record<string, unknown>>)[0]
    expect(entry).toMatchObject({
      timestamp: 1_700_000_000,
      trace_id: TRACE,
      level: 'warn',
      body: 'github:refresh timed out',
      severity_number: 13,
    })
    expect(entry.attributes).toMatchObject({
      owner: { value: 'core', type: 'string' },
      attempts: { value: 3, type: 'integer' },
      retried: { value: true, type: 'boolean' },
      logger: { value: 'schedules', type: 'string' },
    })
  })

  it('borrows one trace id for the lines that have none, because Sentry requires one', () => {
    const [envelope] = buildEnvelopes(batchOf([line(1, { traceId: undefined })]), options())
    expect((payloadOf(envelope).items as Array<Record<string, unknown>>)[0].trace_id).toBe('id-1')
  })

  it('never puts more than one log item in an envelope, and never more than a hundred entries in one', () => {
    const many = Array.from({ length: 150 }, (_, index) => line(index))
    const envelopes = buildEnvelopes(batchOf(many), options())
    expect(envelopes).toHaveLength(2)
    for (const envelope of envelopes) expect(envelope.items).toHaveLength(1)
    expect(envelopes.map((envelope) => (payloadOf(envelope).items as unknown[]).length)).toEqual([100, 50])
  })

  it('sends an event as a log line at info as well as a breadcrumb', () => {
    const event: TelemetryRecord = { kind: 'event', at: 5, name: 'ws.shed', attrs: { channel: 'tasks' } }
    const [envelope] = buildEnvelopes(batchOf([event]), options())
    expect((payloadOf(envelope).items as Array<Record<string, unknown>>)[0]).toMatchObject({ level: 'info', body: 'ws.shed' })
  })

  it('keeps interaction work as an error breadcrumb without exporting a standalone log', () => {
    const work: TelemetryRecord = { kind: 'event', at: 4, name: 'ui.interaction.work', attrs: { operation: 'cache.write', calls: 7 } }
    expect(buildEnvelopes(batchOf([work]), options())).toEqual([])

    const failure: TelemetryRecord = {
      kind: 'error', at: 5, name: 'RangeError', message: 'stack', level: 'error', handled: true, attrs: {},
    }
    const [envelope] = buildEnvelopes(batchOf([work, failure]), options())
    expect(payloadOf(envelope).breadcrumbs.values[0]).toMatchObject({ category: 'ui.interaction.work' })
  })
})

describe('metrics', () => {
  const metric = (over: Partial<Extract<TelemetryRecord, { kind: 'metric' }>>): TelemetryRecord => ({
    kind: 'metric',
    at: 1_700_000_000_000,
    name: 'sync.fresh',
    type: 'count',
    value: 4,
    attrs: { owner: 'core', runtime: 'node' },
    ...over,
  })

  it('sends a count as a counter and a gauge as a gauge, in one trace_metric item', () => {
    const envelopes = buildEnvelopes(batchOf([metric({}), metric({ name: 'queue.depth', type: 'gauge', value: 12 })]), options())
    expect(envelopes).toHaveLength(1)
    expect(envelopes[0].items[0].header).toEqual({
      type: 'trace_metric',
      item_count: 2,
      // A hyphen in the content type and an underscore in the item type. Sentry's spelling.
      content_type: 'application/vnd.sentry.items.trace-metric+json',
    })
    expect(payloadOf(envelopes[0]).items).toMatchObject([
      { name: 'sync.fresh', type: 'counter', value: 4, trace_id: 'id-1' },
      { name: 'queue.depth', type: 'gauge', value: 12 },
    ])
  })

  it('splits a histogram into three gauges and a counter rather than inventing samples', () => {
    const histogram = metric({
      name: 'sql.select',
      type: 'histogram',
      unit: 'millisecond',
      value: { count: 120, sum: 240, min: 1, max: 30, p50: 2, p95: 9 },
    })
    const [envelope] = buildEnvelopes(batchOf([histogram]), options())
    expect(payloadOf(envelope).items).toMatchObject([
      { name: 'sql.select.p50', type: 'gauge', value: 2, unit: 'millisecond' },
      { name: 'sql.select.p95', type: 'gauge', value: 9 },
      { name: 'sql.select.max', type: 'gauge', value: 30 },
      { name: 'sql.select.count', type: 'counter', value: 120 },
    ])
    // No unit on the count: it says how many samples there were, not how many milliseconds of them.
    expect(payloadOf(envelope).items[3]).not.toHaveProperty('unit')
  })

  it('sends nothing when metrics are switched off', () => {
    const settings = { ...DEFAULT_SETTINGS, kinds: { ...DEFAULT_SETTINGS.kinds, metric: false } }
    expect(buildEnvelopes(batchOf([metric({})]), options({ settings }))).toEqual([])
  })
})

describe('serializeEnvelope', () => {
  it('writes a header line, an item header with its byte length, and the payload', () => {
    const [envelope] = buildEnvelopes(batchOf([span()]), options())
    const lines = serializeEnvelope(envelope, { dsn: 'https://k@h/1', sent_at: '2026-09-11T00:00:00.000Z' }).split('\n')
    expect(JSON.parse(lines[0])).toMatchObject({ dsn: 'https://k@h/1', sent_at: '2026-09-11T00:00:00.000Z', event_id: 'id-2' })
    const itemHeader = JSON.parse(lines[1])
    expect(itemHeader.type).toBe('transaction')
    // Declared rather than inferred from the next newline, so an escaped string in a payload cannot
    // change how the rest of the envelope parses.
    expect(itemHeader.length).toBe(new TextEncoder().encode(lines[2]).byteLength)
    expect(lines.at(-1)).toBe('')
  })

  it('serialises the empty probe to one header line', () => {
    expect(serializeEnvelope(probeEnvelope(), { dsn: 'https://k@h/1' })).toBe('{"dsn":"https://k@h/1"}\n')
  })
})
