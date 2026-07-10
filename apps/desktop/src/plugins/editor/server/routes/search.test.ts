import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { SearchResult } from '../../shared/search'
import type { AppEnv } from '../../../../core/server/middleware/auth'
import { requireUser } from '../../../../core/server/middleware/requireUser'
import { search, setSearchBridge, type SearchOpts } from './search'

// Route-test convention for a bridge-backed domain: fake the bridge (no real ripgrep),
// mount the router, and exercise auth + body validation + the bridge-unavailable 503. The rg
// parsing itself is unit-tested in main/search.test.ts.

const jsonReq = (url: string, method: string, body?: unknown) =>
  new Request(`http://acorn.test${url}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const authed = () => {
  const app = new Hono<AppEnv>()
  app.use('/api/*', async (c, next) => {
    c.set('principal', { kind: 'user', user: { token: 't', login: 'james', name: '', avatar: '', scopes: [] } })
    await next()
  })
  return app.route('/api/tasks', search)
}

// The real requireUser gate, for the 401 case.
const gated = () => new Hono<AppEnv>().use('/api/*', requireUser).route('/api/tasks', search)

describe('search route (POST /api/tasks/:id/search)', () => {
  afterEach(() => setSearchBridge(null))

  it('passes query + defaulted opts to the bridge and returns its result', async () => {
    let seen: { taskId: string; query: string; opts: SearchOpts } | null = null
    const result: SearchResult = { files: [{ path: 'a.ts', hits: [{ line: 1, col: 1, endCol: 2, preview: 'x' }] }], truncated: false }
    setSearchBridge({
      findInFiles: async (taskId, query, opts) => {
        seen = { taskId, query, opts }
        return result
      },
    })
    const res = await authed().fetch(jsonReq('/api/tasks/task1/search', 'POST', { query: 'foo' }), {} as Env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(result)
    expect(seen).toEqual({ taskId: 'task1', query: 'foo', opts: { caseSensitive: false, wholeWord: false, regex: false } })
  })

  it('forwards explicit opts', async () => {
    let opts: SearchOpts | null = null
    setSearchBridge({
      findInFiles: async (_t, _q, o) => {
        opts = o
        return { files: [], truncated: false }
      },
    })
    await authed().fetch(jsonReq('/api/tasks/task1/search', 'POST', { query: 'x', opts: { regex: true, caseSensitive: true } }), {} as Env)
    expect(opts).toEqual({ caseSensitive: true, wholeWord: false, regex: true })
  })

  it('401s without a principal', async () => {
    setSearchBridge({ findInFiles: async () => ({ files: [], truncated: false }) })
    const res = await gated().fetch(jsonReq('/api/tasks/task1/search', 'POST', { query: 'foo' }), {} as Env)
    expect(res.status).toBe(401)
  })

  it('400s a malformed body (missing/empty query, non-object)', async () => {
    setSearchBridge({ findInFiles: async () => ({ files: [], truncated: false }) })
    const app = authed()
    expect((await app.fetch(jsonReq('/api/tasks/task1/search', 'POST', {}), {} as Env)).status).toBe(400)
    expect((await app.fetch(jsonReq('/api/tasks/task1/search', 'POST', { query: '' }), {} as Env)).status).toBe(400)
    expect((await app.fetch(jsonReq('/api/tasks/task1/search', 'POST', { query: 42 }), {} as Env)).status).toBe(400)
    expect((await app.fetch(jsonReq('/api/tasks/task1/search', 'POST'), {} as Env)).status).toBe(400)
  })

  it('503s when the bridge is unavailable (dev:node / pre-wire)', async () => {
    const res = await authed().fetch(jsonReq('/api/tasks/task1/search', 'POST', { query: 'foo' }), {} as Env)
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('bridge-unavailable')
  })
})
