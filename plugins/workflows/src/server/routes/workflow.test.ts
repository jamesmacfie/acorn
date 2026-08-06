import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { requireUser } from '@acorn/node-core/server/middleware/requireUser.ts'
import { workflow, setWorkflowBridge, type WorkflowBridge } from './workflow'
import type { Env } from '@acorn/node-core/main/bindings.ts'

// Workflow start/gate execute an agent step, so the route test proves body validation + auth +
// the bridge-unavailable 503 (the privileged-boundary contract). The runner logic is tested in main/workflowRunner.test.ts.

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
  return app.route('/api', workflow)
}
const authed = () => as({ kind: 'device', userId: 'james' })
// A child an agent spawned inside task1 — a workflow step's own environment.
const asTask1 = () => as({ kind: 'internal', userId: 'james', scope: 'task', taskId: 'task1' })

const fake = (over: Partial<WorkflowBridge> = {}): WorkflowBridge => ({
  // run1 belongs to task1; run2 to task2. Anything else does not exist.
  taskIdForRun: async (runId) => (runId === 'run1' ? 'task1' : runId === 'run2' ? 'task2' : null),
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

// A workflow step executes an agent CLI in a worktree, so approving another task's gate or killing its
// step acts on that task. The run-scoped paths carry no taskId, so core's mounted requireTaskScope cannot
// see them — the /tasks/:id half of this router is covered there and is deliberately not retested here.
describe('a task-scoped credential is confined to its own runs', () => {
  afterEach(() => setWorkflowBridge(null))

  it('cannot gate, cancel, kill or read another task run, and cannot probe run ids', async () => {
    const calls: string[] = []
    setWorkflowBridge(fake({
      gate: async (runId) => (calls.push(`gate:${runId}`), { ok: true }),
      cancel: async (runId) => (calls.push(`cancel:${runId}`), { ok: true }),
      kill: async (runId) => (calls.push(`kill:${runId}`), { ok: true }),
      steps: async () => (calls.push('steps'), []),
    }))
    const app = asTask1()
    for (const runId of ['run2', 'nope']) {
      expect((await app.fetch(req(`/api/workflows/runs/${runId}/steps`), {} as Env)).status).toBe(404)
      expect((await app.fetch(req(`/api/workflows/runs/${runId}/gate`, 'POST', { stepId: 's', approved: true }), {} as Env)).status).toBe(404)
      expect((await app.fetch(req(`/api/workflows/runs/${runId}/cancel`, 'POST'), {} as Env)).status).toBe(404)
      expect((await app.fetch(req(`/api/workflows/runs/${runId}/kill`, 'POST', { stepId: 's' }), {} as Env)).status).toBe(404)
    }
    expect(calls).toEqual([])
    // Its own run still works.
    expect((await app.fetch(req('/api/workflows/runs/run1/cancel', 'POST'), {} as Env)).status).toBe(200)
    expect(calls).toEqual(['cancel:run1'])
  })

  it('cannot fire the node-wide trigger poll', async () => {
    let polled = 0
    setWorkflowBridge(fake({ pollTriggers: async () => (polled++, { started: 0, errors: [] }) }))
    // No taskId to confine a sweep to, and it STARTS runs across every task — so refused, not narrowed.
    expect((await asTask1().fetch(req('/api/workflows/triggers/poll', 'POST'), {} as Env)).status).toBe(403)
    expect(polled).toBe(0)
    expect((await authed().fetch(req('/api/workflows/triggers/poll', 'POST'), {} as Env)).status).toBe(200)
    expect(polled).toBe(1)
  })

  it('still answers 503 rather than 404 when the runner is not wired', async () => {
    // dev:node's degraded mode must not be shadowed by the guard.
    expect((await asTask1().fetch(req('/api/workflows/runs/run2/cancel', 'POST'), {} as Env)).status).toBe(503)
  })
})
