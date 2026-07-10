import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppEnv } from '../../../../core/server/middleware/auth'
import { requireUser } from '../../../../core/server/middleware/requireUser'
import { workflow, setWorkflowBridge, type WorkflowBridge } from './workflow'

// Workflow start/gate execute an agent step, so the route test proves body validation + auth +
// the bridge-unavailable 503 (Phase 3 §1). The runner logic is tested in main/workflowRunner.test.ts.

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
  return app.route('/api', workflow)
}

const fake = (over: Partial<WorkflowBridge> = {}): WorkflowBridge => ({
  defs: async () => ({ workflows: [], errors: [] }),
  start: async () => ({ runId: 'run1' }),
  runs: async () => [],
  steps: async () => [],
  gate: async () => ({ ok: true }),
  cancel: async () => ({ ok: true }),
  kill: async () => ({ ok: true }),
  pollTriggers: async () => ({ started: 0, errors: [] }),
  ...over,
})

describe('workflow routes', () => {
  afterEach(() => setWorkflowBridge(null))

  it('starts a run with a valid def and returns the runId', async () => {
    let seen: unknown = null
    setWorkflowBridge(fake({ start: async (_t, def) => ((seen = def), { runId: 'run1' }) }))
    const res = await authed().fetch(req('/api/tasks/task1/workflows', 'POST', { def: { name: 'W', steps: [{ name: 's1' }] } }), {} as Env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ runId: 'run1' })
    expect(seen).toMatchObject({ name: 'W' })
  })

  it('resolves a gate and reads steps by runId', async () => {
    let gated: { runId: string; stepId: string; approved: boolean } | null = null
    setWorkflowBridge(fake({ gate: async (runId, stepId, approved) => ((gated = { runId, stepId, approved }), { ok: true }) }))
    const app = authed()
    expect((await app.fetch(req('/api/workflows/runs/run1/steps'), {} as Env)).status).toBe(200)
    const res = await app.fetch(req('/api/workflows/runs/run1/gate', 'POST', { stepId: 'step1', approved: true }), {} as Env)
    expect(await res.json()).toEqual({ ok: true })
    expect(gated).toEqual({ runId: 'run1', stepId: 'step1', approved: true })
  })

  it('cancels runs, kills steps, and polls app-open triggers', async () => {
    const calls: string[] = []
    setWorkflowBridge(
      fake({
        cancel: async (runId) => (calls.push(`cancel:${runId}`), { ok: true }),
        kill: async (runId, stepId) => (calls.push(`kill:${runId}:${stepId}`), { ok: true }),
        pollTriggers: async () => ({ started: 2, errors: [] }),
      }),
    )
    const app = authed()
    expect((await app.fetch(req('/api/workflows/runs/run1/cancel', 'POST'), {} as Env)).status).toBe(200)
    expect((await app.fetch(req('/api/workflows/runs/run1/kill', 'POST', { stepId: 'step1' }), {} as Env)).status).toBe(200)
    expect(await (await app.fetch(req('/api/workflows/triggers/poll', 'POST'), {} as Env)).json()).toEqual({ started: 2, errors: [] })
    expect(calls).toEqual(['cancel:run1', 'kill:run1:step1'])
  })

  it('400s a malformed start (no name/steps) and gate (missing approved)', async () => {
    setWorkflowBridge(fake())
    const app = authed()
    expect((await app.fetch(req('/api/tasks/task1/workflows', 'POST', { def: { name: 'W' } }), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/tasks/task1/workflows', 'POST', {}), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/workflows/runs/run1/gate', 'POST', { stepId: 'x' }), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/workflows/runs/run1/kill', 'POST', {}), {} as Env)).status).toBe(400)
  })

  it('401s without a principal; 503s without a bridge', async () => {
    const gated = new Hono<AppEnv>().use('/api/*', requireUser).route('/api', workflow)
    expect((await gated.fetch(req('/api/tasks/task1/workflows'), {} as Env)).status).toBe(401)
    expect((await authed().fetch(req('/api/tasks/task1/workflows'), {} as Env)).status).toBe(503)
  })
})
