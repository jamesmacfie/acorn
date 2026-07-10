import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppEnv } from '../middleware/auth'
import { requireUser } from '../middleware/requireUser'
import { setTerminalBridge, terminal, type TerminalBridge } from './terminal'

// Transport contract for terminal control (Phase 3 slice 5): routing + auth + body validation +
// bridge-unavailable. The engine behaviour (PTY spawn, worktree/session lifecycle) is covered by
// main/*.test.ts and the live/smoke pass; the STREAM half is the WebSocket (slice 6).

const req = (url: string, method = 'GET', body?: unknown) =>
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
  return app.route('/api', terminal)
}

const session = { id: 's1', taskId: 'task1', title: 'sh', kind: 'shell', status: 'running', backend: 'pty', cols: 80, rows: 24 }
const fake = (over: Partial<TerminalBridge> = {}): TerminalBridge => ({
  list: async () => [session as never],
  profiles: async () => [],
  create: async () => session as never,
  kill: async () => true,
  interrupt: async () => true,
  remove: async () => true,
  resize: async () => true,
  sendToAgent: async () => ({ ok: true }),
  taskStatuses: async () => [],
  repoPathGet: async () => null,
  repoPathSet: async () => ({ ok: true }) as never,
  repoPathRunTargets: async () => ({ ok: true }) as never,
  previewUrl: async () => ({ ok: true, url: 'http://x' }),
  onCreated: async () => {},
  useCheckout: async () => ({ worktreePath: '/w', branch: 'main' }),
  archive: async () => ({ ok: true }) as never,
  mcpInspect: async () => [],
  mcpCreateStarter: async () => ({ ok: true }),
  ...over,
})

describe('terminal control routes', () => {
  afterEach(() => setTerminalBridge(null))

  it('creates a session, lists, resizes, and archives via the bridge', async () => {
    const seen: string[] = []
    setTerminalBridge(fake({
      create: async (opts) => (seen.push(`create:${opts.taskId}`), session as never),
      resize: async (id, cols, rows) => (seen.push(`resize:${id}:${cols}x${rows}`), true),
      archive: async (id) => (seen.push(`archive:${id}`), { ok: true } as never),
    }))
    const app = authed()
    expect((await app.fetch(req('/api/terminal/sessions'), {} as Env)).status).toBe(200)
    await app.fetch(req('/api/terminal/sessions', 'POST', { taskId: 'task1', profileId: 'shell' }), {} as Env)
    await app.fetch(req('/api/terminal/sessions/s1/resize', 'POST', { cols: 100, rows: 40 }), {} as Env)
    await app.fetch(req('/api/tasks/task1/archive', 'POST', { force: true }), {} as Env)
    expect(seen).toEqual(['create:task1', 'resize:s1:100x40', 'archive:task1'])
  })

  it('use-checkout wraps null-able result; default repo-path get returns null', async () => {
    setTerminalBridge(fake())
    const app = authed()
    expect(await (await app.fetch(req('/api/tasks/task1/use-checkout', 'POST'), {} as Env)).json()).toEqual({ result: { worktreePath: '/w', branch: 'main' } })
    expect(await (await app.fetch(req('/api/terminal/repo-path?owner=a&repo=b'), {} as Env)).json()).toBeNull()
  })

  it('400s malformed create/resize/send bodies and repo-path with no owner', async () => {
    setTerminalBridge(fake())
    const app = authed()
    expect((await app.fetch(req('/api/terminal/sessions', 'POST', {}), {} as Env)).status).toBe(400) // no taskId
    expect((await app.fetch(req('/api/terminal/sessions/s1/resize', 'POST', { cols: 100 }), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/terminal/sessions/s1/send', 'POST', { text: '' }), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/terminal/repo-path'), {} as Env)).status).toBe(400)
  })

  it('401s without a principal; 503s without a bridge', async () => {
    const gated = new Hono<AppEnv>().use('/api/*', requireUser).route('/api', terminal)
    expect((await gated.fetch(req('/api/terminal/sessions'), {} as Env)).status).toBe(401)
    expect((await authed().fetch(req('/api/terminal/sessions'), {} as Env)).status).toBe(503)
  })
})
