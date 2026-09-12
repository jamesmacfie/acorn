import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiError } from '@acorn/protocol/api.ts'
import type { TelemetryError, TelemetryRecord, TelemetrySpan } from '@acorn/protocol/telemetry.ts'
import type { TelemetryMetric } from '@acorn/protocol/telemetry.ts'
import { git } from './core/git'
import { flushTelemetry, onTelemetryBatch, resetTelemetryForTest, startTelemetry } from './telemetry/collector'
import type { AppEnv } from './middleware/auth'
import { onServerError, requestIdMiddleware, respondError } from './respond'
import type { Env } from './bindings'

const app = new Hono<AppEnv>()
  .use('*', requestIdMiddleware)
  .get('/v2/core/boom', () => {
    throw new Error('db exploded')
  })
  .get('/v2/core/tasks/:id', (c) => c.json({ id: c.req.param('id') }))
  .get('/v2/p/rollbar/issues', (c) => c.json({ issues: [] }))
  // A plugin route that reaches the git seam, which is the whole question ambient attribution
  // answers: `core/git.ts` is called from everywhere and knows nothing about its caller.
  .get('/v2/p/rollbar/repo', async (c) => c.json(await git(['rev-parse', '--git-dir'], { cwd: process.cwd() })))
  .get('/v2/core/csrf', () => {
    throw new HTTPException(403)
  })
  .get('/page', () => {
    throw new Error('nope')
  })
  .get('/v2/core/plain', (c) => respondError(c, 404, 'not_found'))
  .get('/v2/core/prose', (c) => respondError(c, 404, 'not_found', ['no such target']))
  .get('/v2/core/rate', (c) => respondError(c, 429, 'rate_limited'))
  .get('/v2/core/detailed', (c) => respondError(c, 409, 'revision_conflict', undefined, { revision: 7 }))
  .onError(onServerError)

const get = (path: string, headers?: Record<string, string>) =>
  app.fetch(new Request(`http://acorn.test${path}`, { headers }), {} as Env)

const bodyOf = async (res: Response) => ((await res.json()) as ApiError).error

describe('error envelope', () => {
  it('carries code, message, requestId and retryable', async () => {
    const res = await get('/v2/core/plain')
    expect(res.status).toBe(404)
    const error = await bodyOf(res)
    expect(error.code).toBe('not_found')
    expect(error.retryable).toBe(false)
    expect(error.requestId).toMatch(/^[0-9a-f-]{36}$/)
    // The requestId in the body is the one the client can quote back from the header.
    expect(res.headers.get('x-request-id')).toBe(error.requestId)
  })

  it('folds caller prose into message', async () => {
    expect(await bodyOf(await get('/v2/core/prose'))).toMatchObject({ code: 'not_found', message: 'no such target' })
  })

  it('derives retryable from the status so no route maintains a table', async () => {
    expect((await bodyOf(await get('/v2/core/rate'))).retryable).toBe(true)
  })

  it('passes structured details through', async () => {
    expect(await bodyOf(await get('/v2/core/detailed'))).toMatchObject({ code: 'revision_conflict', details: { revision: 7 } })
  })
})

describe('requestIdMiddleware', () => {
  it('echoes a well-formed client-supplied id', async () => {
    const res = await get('/v2/core/plain', { 'x-request-id': 'client-abc_123.4' })
    expect(res.headers.get('x-request-id')).toBe('client-abc_123.4')
    expect((await bodyOf(res)).requestId).toBe('client-abc_123.4')
  })

  // A hostile header must not reach a log line or a response header verbatim. (Control characters
  // never get this far, since the HTTP layer rejects them when the Request is built, so the grammar's
  // job is the transportable-but-unwanted rest: spaces, quotes, CRLF-adjacent punctuation.)
  it('replaces a malformed client-supplied id', async () => {
    for (const bad of ['bad id with spaces', 'has"quote', 'semi;colon', '<angle>']) {
      const res = await get('/v2/core/plain', { 'x-request-id': bad })
      expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
    }
  })

  it('replaces an over-long client-supplied id', async () => {
    const res = await get('/v2/core/plain', { 'x-request-id': 'a'.repeat(129) })
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('onServerError backstop', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('wraps uncaught throws without exposing bound values to the client or logs', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const res = await get('/v2/core/boom')
    expect(res.status).toBe(500)
    const error = await bodyOf(res)
    expect(error.code).toBe('internal')
    expect(error.message).not.toContain('db exploded')
    expect(JSON.stringify(logged.mock.calls)).not.toContain('db exploded')
    // The log line must carry the requestId, or the envelope's id correlates with nothing.
    expect(JSON.stringify(logged.mock.calls)).toContain(error.requestId)
  })

  it('lets HTTPExceptions keep their own response (csrf 403 stays 403)', async () => {
    const res = await get('/v2/core/csrf')
    expect(res.status).toBe(403)
  })

  it('speaks the envelope on every path, not just one namespace prefix', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const res = await get('/page')
    expect(res.status).toBe(500)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect((await bodyOf(res)).code).toBe('internal')
  })
})

describe('the request span', () => {
  const settle = async () => {
    for (let index = 0; index < 5; index += 1) await Promise.resolve()
  }
  let seen: TelemetryRecord[]

  beforeEach(async () => {
    resetTelemetryForTest()
    seen = []
    startTelemetry({ node: 'node-1', version: '9', readPref: async () => '1' })
    onTelemetryBatch((batch) => seen.push(...batch.records))
    await settle()
  })

  afterEach(() => resetTelemetryForTest())

  const spans = (): TelemetrySpan[] => {
    flushTelemetry()
    return seen.filter((record): record is TelemetrySpan => record.kind === 'span')
  }

  it('names the route pattern rather than the URL, so a hundred task ids read as one row', async () => {
    await get('/v2/core/tasks/abc-123')
    const [span] = spans()
    expect(span.name).toBe('http.request')
    expect(span.attrs).toMatchObject({ route: '/v2/core/tasks/:id', method: 'GET', status: 200, owner: 'core' })
    expect(JSON.stringify(span.attrs)).not.toContain('abc-123')
  })

  it('carries the request id the envelope and the header carry', async () => {
    const res = await get('/v2/core/tasks/abc-123')
    expect(spans()[0]!.attrs['request.id']).toBe(res.headers.get('x-request-id'))
  })

  it('names the plugin whose namespace the path is in', async () => {
    await get('/v2/p/rollbar/issues')
    expect(spans()[0]!.attrs.owner).toBe('rollbar')
  })

  it('honours a traceparent and ignores a malformed one', async () => {
    const traceId = 'a'.repeat(32)
    const parentSpanId = 'b'.repeat(16)
    await get('/v2/core/tasks/abc-123', { traceparent: `00-${traceId}-${parentSpanId}-01` })
    expect(spans()[0]).toMatchObject({ traceId, parentSpanId })

    seen.length = 0
    await get('/v2/core/tasks/abc-123', { traceparent: 'not-a-traceparent' })
    const fresh = spans()[0]!
    expect(fresh.traceId).not.toBe(traceId)
    expect(fresh.parentSpanId).toBeUndefined()
    // The raw header is never echoed anywhere.
    expect(JSON.stringify(fresh)).not.toContain('not-a-traceparent')
  })

  it('marks a 500 as an error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await get('/v2/core/boom')
    expect(spans()[0]!.status).toBe('error')
    vi.restoreAllMocks()
  })

  it('names the plugin on a git spawn the plugin route made', async () => {
    await get('/v2/p/rollbar/repo')
    flushTelemetry()
    const histogram = seen.find((record): record is TelemetryMetric => record.kind === 'metric' && record.name === 'git.rev-parse')!
    expect(histogram.attrs.owner).toBe('rollbar')
    // The spawn is counted twice on purpose: once as git and once as a child process, because "how
    // long does git take" and "how long does this node spend starting children" are two questions.
    expect(seen.find((record) => record.kind === 'metric' && record.name === 'proc.spawn')!.attrs.owner).toBe('rollbar')
  })

  it("keeps 'db exploded' out of the sink as well as out of the log", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await get('/v2/core/boom')
    flushTelemetry()
    const error = seen.find((record): record is TelemetryError => record.kind === 'error')!
    // A boundary that already withholds a message keeps withholding it once there is somewhere to
    // send it to. Name and code, no message and no stack.
    expect(error).toMatchObject({ name: 'Error', message: '', handled: true })
    expect(error.stack).toBeUndefined()
    expect(JSON.stringify(seen)).not.toContain('db exploded')
    // And it lands in the request's own trace rather than starting a second one.
    expect(error.traceId).toBe(spans()[0]!.traceId)
    vi.restoreAllMocks()
  })
})
