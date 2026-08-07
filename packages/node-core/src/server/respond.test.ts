import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiError } from '@acorn/protocol/api.ts'
import type { AppEnv } from './middleware/auth'
import { onServerError, requestIdMiddleware, respondError } from './respond'
import type { Env } from '../main/bindings'

const app = new Hono<AppEnv>()
  .use('*', requestIdMiddleware)
  .get('/v2/core/boom', () => {
    throw new Error('db exploded')
  })
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
  // never get this far — the HTTP layer rejects them when the Request is built — so the grammar's
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
