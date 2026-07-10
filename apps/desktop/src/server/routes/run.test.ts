import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppEnv } from '../middleware/auth'
import { requireUser } from '../middleware/requireUser'
import { harness, setRunBridge, type RunBridge } from './harness'

// The renderer's run surface reuses the harness RunBridge routes (Phase 3). This proves the
// renderer-facing verbs — targets/start/stop/status + the new default-url — and auth/503.

const req = (url: string, method = 'GET') => new Request(`http://acorn.test${url}`, { method })

const authed = () => {
  const app = new Hono<AppEnv>()
  app.use('/api/*', async (c, next) => {
    c.set('principal', { kind: 'user', user: { token: 't', login: 'james', name: '', avatar: '', scopes: [] } })
    await next()
  })
  return app.route('/api/tasks', harness)
}

const fake = (over: Partial<RunBridge> = {}): RunBridge => ({
  targets: async () => ({ targets: [], errors: [], layouts: [] }),
  start: async () => ({ ok: true, sessionId: 's1' }),
  stop: async () => ({ ok: true }),
  restart: async () => ({ ok: true }),
  status: async () => ({ running: false }),
  defaultUrl: async () => 'http://localhost:3000',
  ...over,
})

describe('run routes (harness RunBridge)', () => {
  afterEach(() => setRunBridge(null))

  it('lists targets, starts/stops, and reads status', async () => {
    let started: { taskId: string; target: string } | null = null
    setRunBridge(fake({ start: async (taskId, target) => ((started = { taskId, target }), { ok: true, sessionId: 's1' }) }))
    const app = authed()
    expect((await app.fetch(req('/api/tasks/task1/run'), {} as Env)).status).toBe(200)
    expect(await (await app.fetch(req('/api/tasks/task1/run/dev/start', 'POST'), {} as Env)).json()).toEqual({ ok: true, sessionId: 's1' })
    expect(started).toEqual({ taskId: 'task1', target: 'dev' })
    expect((await app.fetch(req('/api/tasks/task1/run/dev/status'), {} as Env)).status).toBe(200)
  })

  it('resolves the default target URL (default-url is not shadowed by :target)', async () => {
    setRunBridge(fake())
    const res = await authed().fetch(req('/api/tasks/task1/run/default-url'), {} as Env)
    expect(await res.json()).toEqual({ url: 'http://localhost:3000' })
  })

  it('nulls the default URL when there is no default target', async () => {
    setRunBridge(fake({ defaultUrl: async () => undefined }))
    expect(await (await authed().fetch(req('/api/tasks/task1/run/default-url'), {} as Env)).json()).toEqual({ url: null })
  })

  it('401s without a principal; 503s without a bridge', async () => {
    const gated = new Hono<AppEnv>().use('/api/*', requireUser).route('/api/tasks', harness)
    expect((await gated.fetch(req('/api/tasks/task1/run'), {} as Env)).status).toBe(401)
    expect((await authed().fetch(req('/api/tasks/task1/run'), {} as Env)).status).toBe(503)
  })
})
