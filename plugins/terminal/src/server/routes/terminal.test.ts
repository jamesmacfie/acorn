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

const as = (principal: unknown) => {
  const app = new Hono<AppEnv>()
  app.use('/api/*', async (c, next) => {
    c.set('principal', principal as never)
    await next()
  })
  return app.route('/api', terminal)
}
const authed = () => as({ kind: 'device', userId: 'james' })
// A child an agent spawned inside task1: the credential that lives in every PTY's environment.
const asTask1 = () => as({ kind: 'internal', userId: 'james', scope: 'task', taskId: 'task1' })
// The node calling its own loopback surface — unconfined by construction.
const asService = () => as({ kind: 'internal', userId: 'james', scope: 'service' })

const session = { id: 's1', taskId: 'task1', title: 'sh', kind: 'shell', status: 'running', backend: 'pty', cols: 80, rows: 24 }
// A second task's session, for the ownership tests below. Same engine, different owner.
const otherSession = { ...session, id: 's2', taskId: 'task2', title: 'other' }
const fake = (over: Partial<TerminalBridge> = {}): TerminalBridge => ({
  taskIdFor: (id) => (id === session.id ? session.taskId : id === otherSession.id ? otherSession.taskId : null),
  list: async () => [session as never, otherSession as never],
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

// A PTY is arbitrary command execution as the owner. main/wsHub.ts refuses a task-scoped socket that
// addresses another task's stream; until Phase 3 this router — one directory away — refused nothing, so
// POST /sessions/<any sid>/send typed a shell command into any task's terminal. requireTaskScope cannot
// be mounted over these paths because the session id is opaque, so the checks live in the router.
describe('a task-scoped credential is confined to its own task PTYs', () => {
  afterEach(() => setTerminalBridge(null))

  it('cannot drive another task session, and cannot tell it exists', async () => {
    const typed: string[] = []
    setTerminalBridge(fake({ sendToAgent: async (id, text) => (typed.push(`${id}:${text}`), { ok: true }) }))
    const app = asTask1()
    // The original probe, verbatim: type a shell command into another task's shell.
    const foreign = await app.fetch(req('/api/sessions/s2/send', 'POST', { text: 'rm -rf ~', submit: 'now' }), {} as Env)
    expect(foreign.status).toBe(404)
    // An id that exists nowhere gets the SAME answer, so the surface is not a session-id oracle.
    expect((await app.fetch(req('/api/sessions/nope/send', 'POST', { text: 'x', submit: 'now' }), {} as Env)).status).toBe(404)
    // Nothing reached the engine.
    expect(typed).toEqual([])
    // Its OWN session still works — the guard confines, it does not break the agent.
    expect((await app.fetch(req('/api/sessions/s1/send', 'POST', { text: 'ls', submit: 'now' }), {} as Env)).status).toBe(200)
    expect(typed).toEqual(['s1:ls'])
  })

  it('cannot kill, interrupt, remove or resize another task session', async () => {
    const touched: string[] = []
    setTerminalBridge(fake({
      kill: async (id) => (touched.push(`kill:${id}`), true),
      interrupt: async (id) => (touched.push(`interrupt:${id}`), true),
      remove: async (id) => (touched.push(`remove:${id}`), true),
      resize: async (id) => (touched.push(`resize:${id}`), true),
    }))
    const app = asTask1()
    for (const verb of ['kill', 'interrupt', 'remove'] as const) {
      expect((await app.fetch(req(`/api/sessions/s2/${verb}`, 'POST'), {} as Env)).status).toBe(404)
    }
    expect((await app.fetch(req('/api/sessions/s2/resize', 'POST', { cols: 1, rows: 1 }), {} as Env)).status).toBe(404)
    expect(touched).toEqual([])
  })

  it('cannot spawn a PTY in another task worktree', async () => {
    const spawned: string[] = []
    setTerminalBridge(fake({ create: async (opts) => (spawned.push(opts.taskId), session as never) }))
    const app = asTask1()
    // The taskId is in the BODY here, not the path, so this is the one check a mount could never make.
    expect((await app.fetch(req('/api/sessions', 'POST', { taskId: 'task2' }), {} as Env)).status).toBe(404)
    expect(spawned).toEqual([])
    expect((await app.fetch(req('/api/sessions', 'POST', { taskId: 'task1' }), {} as Env)).status).toBe(200)
    expect(spawned).toEqual(['task1'])
  })

  it('sees only its own task sessions in the roster', async () => {
    setTerminalBridge(fake())
    const mine = (await (await asTask1().fetch(req('/api/sessions'), {} as Env)).json()) as { id: string }[]
    expect(mine.map((s) => s.id)).toEqual(['s1'])
    // A device and the service scope see the whole node, unchanged.
    for (const app of [authed(), asService()]) {
      const all = (await (await app.fetch(req('/api/sessions'), {} as Env)).json()) as { id: string }[]
      expect(all.map((s) => s.id)).toEqual(['s1', 's2'])
    }
  })

  it('still answers 503 rather than 404 when the PTY engine is not wired', async () => {
    // dev:node's degraded mode. "No engine" and "not your session" are different answers, and the
    // client's degraded-mode handling keys on the former — so the guard must not shadow it.
    expect((await asTask1().fetch(req('/api/sessions/s1/kill', 'POST'), {} as Env)).status).toBe(503)
    expect((await asTask1().fetch(req('/api/sessions/s2/kill', 'POST'), {} as Env)).status).toBe(503)
  })
})
