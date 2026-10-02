import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TelemetryAttrs, TelemetryBatch, TelemetryMetric, TelemetryRecord } from '@acorn/protocol/telemetry.ts'
import {
  emitEvent,
  emitSpan,
  flushTelemetry,
  measure,
  onTelemetryBatch,
  recordDuration,
  resetTelemetryForTest,
  startSpan,
  startTelemetry,
  stopTelemetry,
  setTelemetryPref,
  telemetrySummary,
  telemetryEnabled,
  telemetryFor,
} from './collector'

// One collected sink and the records it saw, which is how every assertion below reads what the
// collector produced. A sink is the only way in: there is no "read the ring" verb, on purpose.
const collect = () => {
  const batches: TelemetryBatch[] = []
  const handle = onTelemetryBatch((batch) => batches.push(batch))
  return {
    handle,
    batches,
    records: (): TelemetryRecord[] => batches.flatMap((batch) => batch.records),
  }
}

/** The preference is read through two awaits inside the collector, so a test that wants the switch
 *  on has to let the microtask queue drain first. */
const settle = async () => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}

/** Telemetry on: a sink subscribed and the preference reading `'1'`. Both are required. */
const enable = async () => {
  startTelemetry({ node: 'node-1', version: '9', readPref: async () => '1' })
  const sink = collect()
  await settle()
  return sink
}

beforeEach(() => {
  vi.useFakeTimers()
  resetTelemetryForTest()
})

afterEach(() => {
  resetTelemetryForTest()
  vi.useRealTimers()
})

describe('when nothing is collecting', () => {
  it('builds no record, arms no timer, and hands back an inert span', () => {
    startTelemetry({ node: 'node-1', version: '9' })
    expect(telemetryEnabled()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    const span = startSpan('core', { name: 'http.request' })
    expect(span.traceId).toBe('')
    // Idempotent and inert. A caller writes the same three lines either way.
    span.end('ok')
    span.end('error')
    const sink = collect()
    // Subscribing arms the timer, but the preference is still off, so nothing lands.
    emitEvent('core', 'cache-miss')
    flushTelemetry()
    expect(sink.records()).toEqual([])
  })

  it('needs the preference as well as the sink', async () => {
    startTelemetry({ node: 'node-1', version: '9', readPref: async () => null })
    const sink = collect()
    await settle()
    emitEvent('core', 'cache-miss')
    flushTelemetry()
    expect(sink.records()).toEqual([])
    expect(telemetryEnabled()).toBe(false)
  })

  it('returns the measured value untouched', () => {
    startTelemetry({ node: 'node-1', version: '9' })
    expect(measure('core', 'git.status', () => 42)).toBe(42)
  })
})

describe('when a sink is subscribed and the preference is on', () => {
  it('collects a record and hands it over on flush', async () => {
    const sink = await enable()
    expect(telemetryEnabled()).toBe(true)
    emitEvent('core', 'cache-miss', { resource: 'issues' })
    flushTelemetry()
    expect(sink.records()).toHaveLength(1)
    expect(sink.batches[0]).toMatchObject({ node: 'node-1', version: '9' })
  })

  it('stamps the owner the host passed and drops one the emitter claimed', async () => {
    const sink = await enable()
    emitEvent('rollbar', 'cache-miss', { owner: 'github', runtime: 'shell', resource: 'issues' })
    flushTelemetry()
    expect(sink.records()[0]!.attrs).toEqual({ resource: 'issues', owner: 'rollbar', runtime: 'node' })
  })

  it('flushes on its own every five seconds', async () => {
    const sink = await enable()
    emitEvent('core', 'tick')
    expect(sink.records()).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(sink.records()).toHaveLength(1)
  })

  it('flushes at 500 records without waiting for the timer', async () => {
    const sink = await enable()
    for (let index = 0; index < 500; index += 1) emitEvent('core', 'tick')
    // On the microtask after the 500th, not on the stack of whoever emitted it.
    expect(sink.records()).toHaveLength(0)
    await settle()
    expect(sink.records()).toHaveLength(500)
  })

  it('drops the oldest past the ring cap and counts the drops', async () => {
    const sink = await enable()
    // One synchronous burst, which is the only way to outrun a flush that is scheduled rather than
    // called: 6,000 records into a ring that holds 5,000.
    for (let index = 0; index < 6_000; index += 1) emitEvent('core', 'tick', { index })
    await settle()
    const dropped = sink.records().find((record) => record.kind === 'metric' && record.name === 'telemetry.dropped')
    expect(dropped).toBeDefined()
    expect((dropped as TelemetryMetric).value).toBe(1_000)
    // The oldest went, not the newest: the last record emitted is still in the batch.
    const events = sink.records().filter((record) => record.kind === 'event')
    expect(events[0]!.attrs.index).toBe(1_000)
    expect(events.at(-1)!.attrs.index).toBe(5_999)
  })

  it('folds samples into the six numbers a histogram carries', async () => {
    const sink = await enable()
    for (const value of [1, 2, 3, 4, 100]) recordDuration('core', 'git.status', value)
    flushTelemetry()
    const metric = sink.records().find((record) => record.kind === 'metric' && record.name === 'git.status') as TelemetryMetric
    expect(metric.type).toBe('histogram')
    expect(metric.value).toEqual({ count: 5, sum: 110, min: 1, max: 100, p50: 3, p95: 100 })
    expect(metric.attrs.owner).toBe('core')
  })

  it('keeps two owners of one seam apart', async () => {
    const sink = await enable()
    recordDuration('core', 'git.status', 5)
    recordDuration('github', 'git.status', 50)
    flushTelemetry()
    const owners = sink.records().filter((record) => record.kind === 'metric').map((record) => record.attrs.owner)
    expect(owners.sort()).toEqual(['core', 'github'])
  })

  it('times a promise to settlement and still returns what it wrapped', async () => {
    const sink = await enable()
    await expect(measure('core', 'git.status', async () => 'value')).resolves.toBe('value')
    await expect(measure('core', 'git.fetch', async () => {
      throw new Error('boom')
    })).rejects.toThrow('boom')
    flushTelemetry()
    const names = sink.records().filter((record) => record.kind === 'metric').map((record) => record.name)
    // A rejection is still counted: `finally`, not `then`.
    expect(names.sort()).toEqual(['git.fetch', 'git.status'])
  })

  it('contains a sink that throws and a sink that rejects', async () => {
    await enable()
    onTelemetryBatch(() => {
      throw new Error('sync sink is broken')
    })
    onTelemetryBatch((() => Promise.reject(new Error('async sink is broken'))) as never)
    const good = collect()
    emitEvent('core', 'tick')
    expect(() => flushTelemetry()).not.toThrow()
    // The sink after the broken ones still got the batch.
    expect(good.records()).toHaveLength(1)
  })

  it('flushes what is held on the way out', async () => {
    const sink = await enable()
    emitEvent('core', 'last-word')
    stopTelemetry()
    expect(sink.records()).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('truncates an over-long attribute and counts it', async () => {
    const sink = await enable()
    emitEvent('core', 'tick', { note: 'x'.repeat(900) })
    flushTelemetry()
    expect(String(sink.records()[0]!.attrs.note)).toHaveLength(512)
    const truncated = sink.records().find((record) => record.kind === 'metric' && record.name === 'telemetry.truncated')
    expect(truncated).toBeDefined()
  })

  it('spans carry the trace the caller passed and a parent when there is one', async () => {
    const sink = await enable()
    const trace = 'a'.repeat(32)
    const parent = 'b'.repeat(16)
    const span = startSpan('core', { name: 'http.request', traceId: trace, parentSpanId: parent })
    expect(span.traceId).toBe(trace)
    span.end('error', { status: 500 })
    // A second `end` is ignored, so a `finally` beside an explicit call cannot double-count.
    span.end('ok')
    flushTelemetry()
    const spans = sink.records().filter((record) => record.kind === 'span')
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ traceId: trace, parentSpanId: parent, status: 'error' })
  })

  it('gives a plugin an owner-bound projection it cannot re-address', async () => {
    const sink = await enable()
    const telemetry = telemetryFor('rollbar')
    telemetry.event('cache-miss')
    telemetry.count('items-synced', 7)
    telemetry.gauge('queue-depth', 3)
    telemetry.error({ name: 'UpstreamError', message: 'rate limited' })
    expect(telemetry.measure('fetch', () => 'value')).toBe('value')
    flushTelemetry()
    expect(new Set(sink.records().map((record) => record.attrs.owner))).toEqual(new Set(['rollbar']))
  })

  it('never lets a scrubbed message keep a credential', async () => {
    const sink = await enable()
    telemetryFor('rollbar').error({ name: 'UpstreamError', message: 'Authorization: Bearer abcdefghijklmnop' })
    flushTelemetry()
    const error = sink.records()[0]
    expect(error.kind).toBe('error')
    expect(error.kind === 'error' && error.message).toBe('Authorization: <redacted>')
  })
})

describe('a second start', () => {
  it('resets the ring and re-reads the preference', async () => {
    const sink = await enable()
    emitSpan('core', { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), name: 'http.request', start: 1, durationMs: 1, status: 'ok' })
    // A boot in a process that already booted: the previous ring is not this node's business.
    startTelemetry({ node: 'node-2', version: '10', readPref: async () => '1' })
    await settle()
    flushTelemetry()
    expect(sink.records()).toEqual([])
    emitEvent('core', 'tick')
    flushTelemetry()
    expect(sink.batches.at(-1)).toMatchObject({ node: 'node-2', version: '10' })
  })
})


it('reads revoked consent before handing a buffered window to sinks', async () => {
  let pref = '1'
  startTelemetry({ node: 'node-1', version: '9', readPref: async () => pref })
  const sink = collect()
  await settle()
  emitEvent('core', 'before-off')
  recordDuration('core', 'before-off', 2)
  pref = '0'
  await vi.advanceTimersByTimeAsync(5_000)
  expect(sink.records()).toEqual([])
  pref = '1'
  await vi.advanceTimersByTimeAsync(5_000)
  expect(sink.records()).toEqual([])
})

// Cardinality applies to names as well as labels. Admitted samples retain their exact identity.
describe('total histogram admission', () => {
  it.each(['unlabelled', 'labelled', 'mixed'] as const)('bounds %s series and keeps hot admitted aggregates exact', async mode => {
    const sink = await enable()
    for (let i = 0; i < 1_000; i++) {
      recordDuration(mode === 'mixed' ? `owner-${i % 2}` : 'core', `operation-${i}`, 1, mode === 'unlabelled' ? undefined : { phase: `phase-${i}` })
    }
    recordDuration(mode === 'mixed' ? 'owner-0' : 'core', 'operation-0', 3, mode === 'unlabelled' ? undefined : { phase: 'phase-0' })
    flushTelemetry()
    const rows = sink.records().filter(row => row.kind === 'metric')
    expect(rows.filter(row => row.type === 'histogram')).toHaveLength(200)
    expect(rows.find(row => row.name === 'operation-0')?.value).toEqual({ count: 2, sum: 4, min: 1, max: 3, p50: 3, p95: 3 })
    expect(rows.find(row => row.name === 'telemetry.histogram.refused')?.value).toBe(800)
    recordDuration('core', 'next-window', 7)
    flushTelemetry()
    expect(sink.batches.at(-1)?.records).toHaveLength(1)
    expect(sink.batches.at(-1)?.records[0]).toMatchObject({ name: 'next-window', unit: 'ms', value: { count: 1, sum: 7 } })
  })

  it('keeps scalar types and delimiter-containing labels distinct', async () => {
    const sink = await enable()
    for (const attrs of [{ label: 1 }, { label: '1' }, { 'a=b': 'c' }, { a: 'b=c' }] as TelemetryAttrs[]) recordDuration('core', 'operation', 1, attrs)
    flushTelemetry()
    expect(sink.records().filter(row => row.kind === 'metric' && row.type === 'histogram')).toHaveLength(4)
  })

  it('discards refused samples with their consent window', async () => {
    const sink = await enable()
    for (let i = 0; i < 1_000; i++) recordDuration('core', `operation-${i}`, 1)
    setTelemetryPref(false)
    setTelemetryPref(true)
    recordDuration('core', 'after-consent', 7)
    flushTelemetry()
    expect(sink.records()).toHaveLength(1)
    expect(sink.records()[0]).toMatchObject({ name: 'after-consent', value: { count: 1 } })
  })
})

describe('preference read ownership', () => {
  it.each(['restart', 'stop', 'last sink', 'explicit consent'] as const)('ignores an initial answer after %s', async transition => {
    let resolve!: (value: string) => void
    startTelemetry({ node: 'A', version: '1', readPref: () => new Promise(done => { resolve = done }) })
    const sink = collect()
    if (transition === 'restart') startTelemetry({ node: 'B', version: '1', readPref: async () => '0' })
    if (transition === 'stop') stopTelemetry()
    if (transition === 'last sink') sink.handle.dispose()
    if (transition === 'explicit consent') setTelemetryPref(false)
    resolve('1')
    await settle()
    expect(telemetryEnabled()).toBe(false)
    expect(telemetrySummary().enabled).toBe(false)
  })

  it('joins overlapping ticks and preserves a surviving sink', async () => {
    let resolve!: (value: string) => void
    const readPref = vi.fn(() => new Promise<string>(done => { resolve = done }))
    startTelemetry({ node: 'A', version: '1', readPref })
    const departed = collect()
    const survivor = collect()
    departed.handle.dispose()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(readPref).toHaveBeenCalledTimes(1)
    resolve('1')
    await settle()
    emitEvent('core', 'survivor')
    flushTelemetry()
    expect(survivor.records()).toContainEqual(expect.objectContaining({ name: 'survivor' }))
    expect(departed.records()).toEqual([])
  })

  it('ignores a held tick answer after stop', async () => {
    let resolve!: (value: string) => void
    let held = false
    startTelemetry({ node: 'A', version: '1', readPref: () => held ? new Promise(done => { resolve = done }) : Promise.resolve('1') })
    const sink = collect()
    await settle()
    held = true
    await vi.advanceTimersByTimeAsync(5_000)
    emitEvent('core', 'final')
    stopTelemetry()
    const count = sink.records().length
    resolve('0')
    await settle()
    expect(telemetrySummary().enabled).toBe(true)
    expect(sink.records()).toHaveLength(count)
    expect(vi.getTimerCount()).toBe(0)
  })
})
