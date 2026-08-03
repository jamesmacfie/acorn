import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { requireUser } from '@acorn/node-core/server/middleware/requireUser.ts'
import { setTerminalBridge, terminal, type TerminalBridge } from './terminal'
import type { Env } from '@acorn/node-core/main/bindings.ts'

// Transport contract for terminal control: routing, auth, body validation, and clean
// bridge-unavailable degradation. PTY behavior is covered by main tests; streaming is covered at the
// WebSocket boundary.
//
// The worktree/repo-path/task-lifecycle half of this router moved to core in Phase 2's scope-shed —
// its transport contract now lives in packages/node-core/src/server/routes/worktree.test.ts.

const req = (url: string, method = 'GET', body?: unknown) =>
  new Request(`http://acorn.test${url}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const authed = () => {
  const app = new Hono<AppEnv>()
  app.use('/api/*', async (c, next) => {
    c.set('principal', { kind: 'device', userId: 'james' })
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
  ...over,
})

describe('terminal control routes', () => {
  afterEach(() => setTerminalBridge(null))

  it('creates a session, lists, and resizes via the bridge', async () => {
    const seen: string[] = []
    setTerminalBridge(fake({
      create: async (opts) => (seen.push(`create:${opts.taskId}`), session as never),
      resize: async (id, cols, rows) => (seen.push(`resize:${id}:${cols}x${rows}`), true),
      kill: async (id) => (seen.push(`kill:${id}`), true),
    }))
    const app = authed()
    // De-doubled paths: /sessions, not /terminal/sessions. Under the plugin namespace this is
    // /v2/p/terminal/sessions, which is what docs/vNext/protocol.md § HTTP conventions specifies.
    expect((await app.fetch(req('/api/sessions'), {} as Env)).status).toBe(200)
    await app.fetch(req('/api/sessions', 'POST', { taskId: 'task1', profileId: 'shell' }), {} as Env)
    await app.fetch(req('/api/sessions/s1/resize', 'POST', { cols: 100, rows: 40 }), {} as Env)
    await app.fetch(req('/api/sessions/s1/kill', 'POST'), {} as Env)
    expect(seen).toEqual(['create:task1', 'resize:s1:100x40', 'kill:s1'])
  })

  it('400s malformed create/resize/send bodies', async () => {
    setTerminalBridge(fake())
    const app = authed()
    expect((await app.fetch(req('/api/sessions', 'POST', {}), {} as Env)).status).toBe(400) // no taskId
    expect((await app.fetch(req('/api/sessions/s1/resize', 'POST', { cols: 100 }), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/sessions/s1/send', 'POST', { text: '' }), {} as Env)).status).toBe(400)
  })

  it('no longer serves the routes that moved to core', async () => {
    setTerminalBridge(fake())
    const app = authed()
    // The scope-shed is only real if these are GONE from the plugin, not merely duplicated in core.
    for (const [path, method] of [
      ['/api/terminal/sessions', 'GET'],
      ['/api/terminal/repo-path', 'GET'],
      ['/api/terminal/task-statuses', 'GET'],
      ['/api/tasks/task1/archive', 'POST'],
      ['/api/tasks/task1/use-checkout', 'POST'],
      ['/api/tasks/task1/mcp', 'GET'],
    ] as const) {
      expect((await app.fetch(req(path, method), {} as Env)).status).toBe(404)
    }
  })

  it('401s without a principal; 503s without a bridge', async () => {
    const gated = new Hono<AppEnv>().use('/api/*', requireUser).route('/api', terminal)
    expect((await gated.fetch(req('/api/sessions'), {} as Env)).status).toBe(401)
    expect((await authed().fetch(req('/api/sessions'), {} as Env)).status).toBe(503)
  })
})
