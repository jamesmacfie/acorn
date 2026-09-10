import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TelemetryBatch, TelemetryRecord } from '@acorn/protocol/telemetry.ts'
import { TELEMETRY_BATCH_MAX_BYTES } from '@acorn/protocol/telemetry.ts'
import type { TelemetrySummary } from '@acorn/protocol/api.ts'
import type { AppEnv, Principal } from '../middleware/auth'
import { requireDevice } from '../middleware/requireUser'
import { requestIdMiddleware } from '../respond'
import { flushTelemetry, onTelemetryBatch, resetTelemetryForTest, startTelemetry } from '../telemetry/collector'
import type { Env } from '../bindings'
import { telemetry } from './telemetry'

// The route is mounted under `requireDevice` in server/index.ts, and mountCoverage.test.ts is what
// proves it stayed there. This file rebuilds the same envelope so the refusal and the ingest can be
// driven with a principal of either kind.
const DEVICE: Principal = { kind: 'device', userId: 'u1', deviceId: 'd1' }
const AGENT: Principal = { kind: 'internal', userId: 'u1', scope: 'task', taskId: 't1' }

const appFor = (principal: Principal) =>
  new Hono<AppEnv>()
    .use('*', requestIdMiddleware)
    .use('*', async (c, next) => {
      c.set('principal', principal)
      await next()
    })
    .use('/v2/core/telemetry', requireDevice)
    .use('/v2/core/telemetry/*', requireDevice)
    .route('/v2/core/telemetry', telemetry)

const get = (principal: Principal, path: string) =>
  appFor(principal).fetch(new Request(`http://acorn.test${path}`), {} as Env)

const post = (principal: Principal, body: string) =>
  appFor(principal).fetch(
    new Request('http://acorn.test/v2/core/telemetry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }),
    {} as Env,
  )

const record = (attrs: Record<string, string> = {}): TelemetryRecord => ({
  kind: 'event',
  at: 1,
  name: 'nav.change',
  attrs,
})

let batches: TelemetryBatch[]

beforeEach(() => {
  resetTelemetryForTest()
  batches = []
  startTelemetry({ node: 'node-1', version: '9.9.9', readPref: async () => '1' })
  onTelemetryBatch((batch) => batches.push(batch))
})
afterEach(() => resetTelemetryForTest())

// `startTelemetry` reads the preference asynchronously, so a test that posts on the same tick sees
// the collector still off. One turn of the microtask queue is what the boot itself takes.
const collecting = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

// The request middleware spans the POST itself, so every flush here holds one `http.request` the
// route did not ingest. Filtered out rather than asserted around, because what this file is about is
// what came out of the batch.
const flushed = (): TelemetryRecord[] => {
  flushTelemetry()
  return batches.flatMap((batch) => batch.records).filter((r) => r.kind !== 'span' || r.name !== 'http.request')
}

describe('POST /v2/core/telemetry', () => {
  it('takes a batch from a device and hands it to the sink', async () => {
    await collecting()
    const res = await post(DEVICE, JSON.stringify({ runtime: 'renderer', records: [record()] }))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ accepted: 1 })
    expect(flushed()).toHaveLength(1)
  })

  it('re-stamps the runtime from the batch and never from the record', async () => {
    await collecting()
    // A record claiming to be the node's own. If this survived, a sink could not tell a renderer's
    // words from the collector's.
    await post(DEVICE, JSON.stringify({
      runtime: 'renderer',
      records: [record({ runtime: 'node', owner: 'agents' })],
    }))
    const [only] = flushed()
    expect(only.attrs.runtime).toBe('renderer')
    // The owner survives, because only the runtime that emitted the record knows which plugin's
    // pane or frame caused it.
    expect(only.attrs.owner).toBe('agents')
  })

  it('scrubs a log body again on this side', async () => {
    await collecting()
    await post(DEVICE, JSON.stringify({
      runtime: 'renderer',
      records: [{ kind: 'log', at: 1, level: 'warn', logger: 'plugins', body: 'token ghp_0123456789abcdefghijklmnopqrstuvwxyz', attrs: {} }],
    }))
    const [only] = flushed()
    expect(only.kind).toBe('log')
    expect(only.kind === 'log' && only.body).not.toContain('ghp_0123456789')
  })

  it('refuses a task-scoped token', async () => {
    await collecting()
    const res = await post(AGENT, JSON.stringify({ runtime: 'renderer', records: [record()] }))
    expect(res.status).toBe(403)
    expect(flushed()).toEqual([])
  })

  it('refuses a batch that claims to be the node', async () => {
    await collecting()
    const res = await post(DEVICE, JSON.stringify({ runtime: 'node', records: [record()] }))
    expect(res.status).toBe(400)
    expect(flushed()).toEqual([])
  })

  it('refuses a whole batch for one malformed record', async () => {
    await collecting()
    const res = await post(DEVICE, JSON.stringify({
      runtime: 'renderer',
      records: [record(), { kind: 'event', at: 1, name: 'x', attrs: { nested: { body: 'secret' } } }],
    }))
    expect(res.status).toBe(400)
    expect(flushed()).toEqual([])
  })

  it('refuses a body over a mebibyte', async () => {
    await collecting()
    const fat = 'x'.repeat(TELEMETRY_BATCH_MAX_BYTES + 1)
    const res = await post(DEVICE, JSON.stringify({ runtime: 'renderer', records: [record({ note: fat })] }))
    expect(res.status).toBe(413)
    expect(flushed()).toEqual([])
  })

  it('accepts and drops when nothing is collecting', async () => {
    // No sink and no preference. The caller is not told to stop: it reads the preference on its own
    // tick, and answering with an error would make a switch that is simply off look like a failure.
    resetTelemetryForTest()
    startTelemetry({ node: 'node-1', version: '9.9.9' })
    const res = await post(DEVICE, JSON.stringify({ runtime: 'renderer', records: [record()] }))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ accepted: 0 })
  })
})

describe('GET /v2/core/telemetry/summary', () => {
  it('counts what was collected, per owner and kind', async () => {
    await collecting()
    await post(DEVICE, JSON.stringify({ runtime: 'renderer', records: [record({ owner: 'github' }), record({ owner: 'github' }), record()] }))

    const summary = await (await get(DEVICE, '/v2/core/telemetry/summary')).json() as TelemetrySummary
    expect(summary.collecting).toBe(true)
    expect(summary.enabled).toBe(true)
    const rows = Object.fromEntries(summary.records.map((row) => [`${row.owner}:${row.kind}`, row.count]))
    // Two under the owner the renderer named, one under core, and the POST's own request span.
    expect(rows['github:event']).toBe(2)
    expect(rows['core:event']).toBe(1)
    expect(rows['core:span']).toBe(1)
    expect(summary.since).toBeLessThanOrEqual(Date.now())
    expect(summary.dropped).toBe(0)
  })

  it('names the plugins reading the stream, and says when nothing is', async () => {
    // The sink in `beforeEach` registered with no owner, which is what core's own do.
    expect((await (await get(DEVICE, '/v2/core/telemetry/summary')).json() as TelemetrySummary).sinks).toEqual(['core'])

    resetTelemetryForTest()
    startTelemetry({ node: 'node-1', version: '9.9.9' })
    const summary = await (await get(DEVICE, '/v2/core/telemetry/summary')).json() as TelemetrySummary
    expect(summary.sinks).toEqual([])
    expect(summary.collecting).toBe(false)
    expect(summary.records).toEqual([])
  })

  it('refuses a task-scoped token, like the rest of this router', async () => {
    // 403 and not 404: `requireDevice` says which kind of principal a route needs, and the route's
    // existence is not the secret. The secret is what it would answer.
    const res = await get(AGENT, '/v2/core/telemetry/summary')
    expect(res.status).toBe(403)
  })
})
