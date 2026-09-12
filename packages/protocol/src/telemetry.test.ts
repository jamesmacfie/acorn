import { describe, expect, it } from 'vitest'
import {
  formatTraceparent,
  parseTraceparent,
  POSTED_TELEMETRY_RUNTIMES,
  postedTelemetryBatchSchema,
  TELEMETRY_RUNTIMES,
  telemetryBatchSchema,
  telemetryRecordSchema,
} from './telemetry.ts'

const TRACE = 'a'.repeat(32)
const SPAN = 'b'.repeat(16)

describe('the record shapes', () => {
  it('parses one of each kind', () => {
    const records = [
      { kind: 'span', traceId: TRACE, spanId: SPAN, name: 'http.request', start: 1, durationMs: 2, status: 'ok', attrs: { route: '/v2/core/tasks/:id' } },
      { kind: 'log', at: 1, level: 'info', logger: 'server', body: 'listening', attrs: {} },
      { kind: 'event', at: 1, name: 'ws.shed', attrs: { channel: 'term' } },
      { kind: 'metric', at: 1, name: 'git.status', type: 'histogram', value: { count: 3, sum: 9, min: 1, max: 5, p50: 3, p95: 5 }, attrs: {} },
      { kind: 'error', at: 1, name: 'ApiError', message: 'not_found', level: 'error', handled: true, attrs: {} },
    ]
    for (const record of records) expect(telemetryRecordSchema.safeParse(record).success, record.kind).toBe(true)
  })

  it('refuses a nested attribute', () => {
    // The rule the audit trail already lives by: an attribute is a scalar, because a record that can
    // hold an object is a record a request body can hide inside.
    const nested = { kind: 'event', at: 1, name: 'cache-miss', attrs: { request: { body: 'secret' } } }
    expect(telemetryRecordSchema.safeParse(nested).success).toBe(false)
    const listed = { kind: 'event', at: 1, name: 'cache-miss', attrs: { ids: ['a', 'b'] } }
    expect(telemetryRecordSchema.safeParse(listed).success).toBe(false)
  })

  it('refuses an id that is not the W3C size', () => {
    const short = { kind: 'span', traceId: 'abc', spanId: SPAN, name: 'x', start: 1, durationMs: 1, status: 'ok', attrs: {} }
    expect(telemetryRecordSchema.safeParse(short).success).toBe(false)
  })

  it('carries the node and the version on the batch, not on every record', () => {
    const batch = telemetryBatchSchema.safeParse({ node: 'node-1', version: '0.1.0', records: [] })
    expect(batch.success).toBe(true)
  })
})

describe('parseTraceparent', () => {
  it('accepts the W3C form and reads the sampled flag', () => {
    expect(parseTraceparent(`00-${TRACE}-${SPAN}-01`)).toEqual({ traceId: TRACE, parentSpanId: SPAN, sampled: true })
    expect(parseTraceparent(`00-${TRACE}-${SPAN}-00`)?.sampled).toBe(false)
    // Case and surrounding space are the two things a proxy is allowed to have changed.
    expect(parseTraceparent(`  00-${TRACE.toUpperCase()}-${SPAN}-01  `)?.traceId).toBe(TRACE)
  })

  it('round-trips what it formats', () => {
    expect(parseTraceparent(formatTraceparent(TRACE, SPAN))).toEqual({ traceId: TRACE, parentSpanId: SPAN, sampled: true })
  })

  it('rejects everything else', () => {
    for (const bad of [
      undefined,
      '',
      `00-${TRACE}-${SPAN}`, // no flags
      `00-${'a'.repeat(31)}-${SPAN}-01`, // trace id one short
      `00-${TRACE}-${'b'.repeat(15)}-01`, // span id one short
      `ff-${TRACE}-${SPAN}-01`, // the reserved invalid version
      `00-${'0'.repeat(32)}-${SPAN}-01`, // all-zero trace id
      `00-${TRACE}-${'0'.repeat(16)}-01`, // all-zero parent
      `00-${TRACE}-${SPAN}-01, 00-${TRACE}-${SPAN}-01`, // two headers merged by fetch
      `00-${TRACE}-${SPAN}-0z`,
      'not a header at all',
    ]) {
      expect(parseTraceparent(bad), String(bad)).toBeNull()
    }
  })
})

describe('the batch a runtime posts to the node', () => {
  const batch = { runtime: 'renderer', records: [] }

  it('names which runtime built it', () => {
    expect(postedTelemetryBatchSchema.safeParse(batch).success).toBe(true)
  })

  it('refuses a batch that claims to be the node', () => {
    // The node's collector is the only thing that may stamp `node`. Anything holding a device token
    // could otherwise file records as the node's own, and a sink reading them has no way to tell.
    expect(postedTelemetryBatchSchema.safeParse({ ...batch, runtime: 'node' }).success).toBe(false)
    expect(POSTED_TELEMETRY_RUNTIMES).toEqual(TELEMETRY_RUNTIMES.filter((runtime) => runtime !== 'node'))
  })

  it('refuses a batch with no runtime at all', () => {
    const { runtime: _runtime, ...bare } = batch
    expect(postedTelemetryBatchSchema.safeParse(bare).success).toBe(false)
  })
})


it('splits multibyte telemetry on wire bytes and counts oversized records', async () => {
  const { encodeTelemetryBatches, TELEMETRY_BATCH_MAX_BYTES } = await import('./telemetry')
  const record = { kind: 'log' as const, at: 1, level: 'info' as const, logger: 'test', body: '界'.repeat(2_000), attrs: {} }
  const records = Array.from({ length: 500 }, () => record)
  const bodies = encodeTelemetryBatches('renderer', [...records, { ...record, body: 'x'.repeat(TELEMETRY_BATCH_MAX_BYTES) }])
  expect(bodies.length).toBeGreaterThan(1)
  const decoded = bodies.flatMap((body) => {
    expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(TELEMETRY_BATCH_MAX_BYTES)
    return JSON.parse(body).records
  })
  expect(decoded.slice(0, 500)).toEqual(records)
  expect(decoded[500]).toMatchObject({ name: 'telemetry.dropped', value: 1 })
})
