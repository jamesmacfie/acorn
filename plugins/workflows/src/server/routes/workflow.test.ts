import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '@acorn/plugin-api/testkit'
import { requireUser } from '@acorn/plugin-api/testkit'
import { BridgeError, ProviderOperationError } from '@acorn/plugin-api/node'
import { workflow, setWorkflowBridge, type WorkflowBridge } from './workflow'
import { setWorkflowDefsBridge, workflowDefsRoutes, type WorkflowDefsBridge } from './defs'
import type { Env } from '@acorn/plugin-api/testkit'

// Workflow start/gate execute an agent step, so the route test proves body validation, auth, and
// the bridge-unavailable 503 (the privileged-boundary contract). The runner logic is tested in
// the run and dispatch tests.

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
// A child an agent spawned inside task1: a workflow step's own environment.
const asTask1 = () => as({ kind: 'internal', userId: 'james', scope: 'task', taskId: 'task1' })

const fake = (over: Partial<WorkflowBridge> = {}): WorkflowBridge => ({
  // run1 belongs to task1; run2 to task2. Anything else does not exist.
  taskIdForRun: async (runId) => (runId === 'run1' ? 'task1' : runId === 'run2' ? 'task2' : null),
  defs: async () => ({ workflows: [], errors: [] }),
  catalog: async () => ({ kinds: [], policies: [], profiles: [] }),
  start: async () => ({ runId: 'run1' }),
  startById: async () => ({ runId: 'run1' }),
  runs: async () => [],
  run: async () => null,
  steps: async () => [],
  stepStatuses: async () => ({ steps: [], truncated: false }),
  gate: async () => ({ ok: true }),
  cancel: async () => ({ ok: true }),
  kill: async () => ({ ok: true }),
  retry: async () => ({ ok: true }),
  runForSession: async () => null,
  allRuns: async () => ({ runs: [] }),
  ...over,
})

describe('workflow routes', () => {
  afterEach(() => setWorkflowBridge(null))

  it('keeps processing history and reprocess preparation device-only', async () => {
    const records = vi.fn(async () => ({ records: [] }))
    const prepareReprocess = vi.fn(async () => ({ digest: 'retained' }))
    const reprocess = vi.fn(async () => ({ runId: 'new-run', taskId: 'new-task' }))
    setWorkflowBridge(fake({ records, prepareReprocess, reprocess }))
    const path = '/api/workflows/runs/run1/records'
    expect((await asTask1().fetch(req(path), {} as Env)).status).toBe(403)
    expect((await asTask1().fetch(req(`${path}/row/prepare-reprocess`, 'POST', {}), {} as Env)).status).toBe(403)
    expect((await asTask1().fetch(req(`${path}/row/reprocess`, 'POST', { digest: 'retained', requestId: 'request' }), {} as Env)).status).toBe(403)
    expect(records).not.toHaveBeenCalled()
    expect(prepareReprocess).not.toHaveBeenCalled()
    expect((await authed().fetch(req(path), {} as Env)).status).toBe(200)
    expect((await authed().fetch(req(`${path}/row/prepare-reprocess`, 'POST', { scopeKey: 'forged' }), {} as Env)).status).toBe(400)
    expect((await authed().fetch(req(`${path}/row/prepare-reprocess`, 'POST', {}), {} as Env)).status).toBe(200)
    expect((await authed().fetch(req(`${path}/row/reprocess`, 'POST', { digest: 'retained' }), {} as Env)).status).toBe(400)
    expect((await authed().fetch(req(`${path}/row/reprocess`, 'POST', { digest: 'retained', requestId: 'request' }), {} as Env)).status).toBe(200)
    expect(reprocess).toHaveBeenCalledWith('run1', 'row', 'retained', 'request')
  })

  it('rejects malformed history cursors and oversized pages before the bridge', async () => {
    const recordAttempts = vi.fn(async () => ({ attempts: [] }))
    setWorkflowBridge(fake({ recordAttempts }))
    const path = '/api/workflows/runs/run1/records/row/attempts'
    for (const after of ['null', '{', '{}', '{"at":"1","id":"x"}']) {
      expect((await authed().fetch(req(`${path}?after=${encodeURIComponent(after)}`), {} as Env)).status).toBe(400)
    }
    expect((await authed().fetch(req(`${path}?limit=101`), {} as Env)).status).toBe(400)
    expect(recordAttempts).not.toHaveBeenCalled()
  })

  it('scopes the authoring catalog to a project and keeps it behind the device gate', async () => {
    const projects: Array<string | undefined> = []
    setWorkflowBridge(fake({ catalog: async (projectId) => {
      projects.push(projectId)
      return { kinds: [], policies: [], profiles: [], workflows: [] }
    } }))

    expect((await authed().fetch(req('/api/catalog?projectId=project-one'), {} as Env)).status).toBe(200)
    expect((await asTask1().fetch(req('/api/catalog?projectId=project-one'), {} as Env)).status).toBe(403)
    expect(projects).toEqual(['project-one'])
  })

  it('refuses inline definitions instead of executing an unpublished draft', async () => {
    let seen: unknown = null
    setWorkflowBridge(fake({ start: async (_t, def) => ((seen = def), { runId: 'run1' }) }))
    const res = await authed().fetch(req('/api/tasks/task1/workflows', 'POST', { def: { baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'W', steps: [{ name: 's1' }] } }), {} as Env)
    expect(res.status).toBe(400)
    expect(seen).toBeNull()
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

  it('carries approved form values, and refuses values on a rejection before the bridge', async () => {
    const seen: unknown[] = []
    setWorkflowBridge(fake({ gate: async (_runId, _stepId, approved, values) => (seen.push({ approved, values }), { ok: true }) }))
    const app = authed()
    expect((await app.fetch(req('/api/workflows/runs/run1/gate', 'POST', { stepId: 's', approved: true, values: { title: 'Edited', notify: true } }), {} as Env)).status).toBe(200)
    expect((await app.fetch(req('/api/workflows/runs/run1/gate', 'POST', { stepId: 's', approved: false, values: { title: 'x' } }), {} as Env)).status).toBe(400)
    expect(seen).toEqual([{ approved: true, values: { title: 'Edited', notify: true } }])
  })

  it('answers 409 when another device already answered the gate', async () => {
    setWorkflowBridge(fake({ gate: async () => { throw new BridgeError(409, 'gate-resolved', 'This gate was already answered.') } }))
    const res = await authed().fetch(req('/api/workflows/runs/run1/gate', 'POST', { stepId: 'step1', approved: false }), {} as Env)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatchObject({ code: 'gate-resolved', message: 'This gate was already answered.' })
  })

  it('cancels runs and kills steps', async () => {
    const calls: string[] = []
    setWorkflowBridge(
      fake({
        cancel: async (runId) => (calls.push(`cancel:${runId}`), { ok: true }),
        kill: async (runId, stepId) => (calls.push(`kill:${runId}:${stepId}`), { ok: true }),
      }),
    )
    const app = authed()
    expect((await app.fetch(req('/api/workflows/runs/run1/cancel', 'POST'), {} as Env)).status).toBe(200)
    expect((await app.fetch(req('/api/workflows/runs/run1/kill', 'POST', { stepId: 'step1' }), {} as Env)).status).toBe(200)
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

  it('carries typed start inputs to the runner without coercion', async () => {
    let seen: unknown = 'unset'
    setWorkflowBridge(fake({ startById: async (_t, _def, inputs) => ((seen = inputs), { runId: 'run1' }) }))
    const app = authed()
    const defId = 'published-workflow'
    expect((await app.fetch(req('/api/tasks/task1/workflows', 'POST', { defId, inputs: { issue: 'It crashes' } }), {} as Env)).status).toBe(200)
    expect(seen).toEqual({ issue: 'It crashes' })
    // Absent is not the same as empty: which names are allowed is the runner's answer, not the route's.
    await app.fetch(req('/api/tasks/task1/workflows', 'POST', { defId }), {} as Env)
    expect(seen).toBeUndefined()
    const typed = { issue: 12, enabled: false, record: { nested: [null, { value: true }] } }
    expect((await app.fetch(req('/api/tasks/task1/workflows', 'POST', { defId, inputs: typed }), {} as Env)).status).toBe(200)
    expect(seen).toEqual(typed)
  })

  it('retries a failed step, and 400s a retry with no stepId', async () => {
    let retried: unknown = null
    setWorkflowBridge(fake({ retry: async (runId, stepId, prompt) => ((retried = { runId, stepId, prompt }), { ok: true }) }))
    const app = authed()
    const res = await app.fetch(req('/api/workflows/runs/run1/retry', 'POST', { stepId: 'step1', prompt: 'Again.' }), {} as Env)
    expect(res.status).toBe(200)
    expect(retried).toEqual({ runId: 'run1', stepId: 'step1', prompt: 'Again.' })
    expect((await app.fetch(req('/api/workflows/runs/run1/retry', 'POST', {}), {} as Env)).status).toBe(400)
  })

  it('starts a definition by id and refuses a body carrying both, or neither', async () => {
    let seen: unknown = null
    setWorkflowBridge(fake({ startById: async (_t, defId, inputs) => ((seen = { defId, inputs }), { runId: 'run1' }) }))
    const app = authed()
    const res = await app.fetch(req('/api/tasks/task1/workflows', 'POST', { defId: 'repo:ship', inputs: { issue: 'x' } }), {} as Env)
    expect(res.status).toBe(200)
    expect(seen).toEqual({ defId: 'repo:ship', inputs: { issue: 'x' } })
    const def = { baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'W', steps: [{ name: 's1' }] }
    expect((await app.fetch(req('/api/tasks/task1/workflows', 'POST', { def, defId: 'repo:ship' }), {} as Env)).status).toBe(400)
  })

  it.each([
    ['task process', { kind: 'internal', userId: 'james', scope: 'task', taskId: 'task1' }],
    ['restricted session', { kind: 'internal', userId: 'james', scope: 'task', taskId: 'task1', sessionId: 'restricted', toolCeiling: { maxRisk: 'read' } }],
    ['workflow session', { kind: 'internal', userId: 'james', scope: 'task', taskId: 'task1', sessionId: 'workflow-step' }],
    ['service process', { kind: 'internal', userId: 'james', scope: 'service' }],
  ])('refuses root starts from a %s before reading the body or calling the bridge', async (_label, principal) => {
    const start = vi.fn()
    const startById = vi.fn()
    setWorkflowBridge(fake({ start, startById }))
    const app = as(principal)
    const path = '/api/tasks/task1/workflows'
    const requests = [
      ...['repo:ship', 'user:ship', 'a-row-uuid'].map(defId => req(path, 'POST', { defId })),
      req(path, 'POST', { def: { name: 'Parent', steps: [{ kind: 'workflow', childWorkflow: { ref: { source: 'database', id: 'owner-draft' } } }] } }),
      req(path, 'POST', {}),
      new Request(`http://acorn.test${path}`, { method: 'POST', body: '{malformed' }),
    ]
    for (const request of requests) {
      const response = await app.fetch(request, {} as Env)
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ error: { code: 'interactive_user_required' } })
      expect(request.bodyUsed).toBe(false)
    }
    expect(start).not.toHaveBeenCalled()
    expect(startById).not.toHaveBeenCalled()
    setWorkflowBridge(null)
    expect((await app.fetch(req(path, 'POST', { defId: 'repo:ship' }), {} as Env)).status).toBe(403)
  })

  it.each(['repo:ship', 'user:ship', 'published-row'])('lets a device start %s with database children permitted', async defId => {
    const startById = vi.fn(async () => ({ runId: 'run1' }))
    setWorkflowBridge(fake({ startById }))
    const response = await authed().fetch(req('/api/tasks/task1/workflows', 'POST', { defId }), {} as Env)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ runId: 'run1' })
    expect(startById).toHaveBeenCalledExactlyOnceWith('task1', defId, undefined, true)
  })

  it('hands a task-confined caller the file layers alone', async () => {
    const asked: boolean[] = []
    setWorkflowBridge(fake({ defs: async (_id, includeRows) => (asked.push(includeRows), { workflows: [], errors: [] }) }))
    await authed().fetch(req('/api/tasks/task1/workflows'), {} as Env)
    await asTask1().fetch(req('/api/tasks/task1/workflows'), {} as Env)
    expect(asked).toEqual([true, false])
  })

  it('401s without a principal; 503s without a bridge', async () => {
    const gated = new Hono<AppEnv>().use('/api/*', requireUser).route('/api', workflow)
    expect((await gated.fetch(req('/api/tasks/task1/workflows'), {} as Env)).status).toBe(401)
    expect((await authed().fetch(req('/api/tasks/task1/workflows'), {} as Env)).status).toBe(503)
  })
})

// A workflow step executes an agent CLI in a worktree, so approving another task's gate or killing
// its step acts on that task. The run-scoped paths carry no taskId, so core's mounted
// requireTaskScope cannot see them. The /tasks/:id half is covered there, not here.
describe('a task-scoped credential is confined to its own runs', () => {
  afterEach(() => setWorkflowBridge(null))

  it('cannot gate, cancel, kill or read another task run, and cannot probe run ids', async () => {
    const calls: string[] = []
    setWorkflowBridge(fake({
      gate: async (runId) => (calls.push(`gate:${runId}`), { ok: true }),
      cancel: async (runId) => (calls.push(`cancel:${runId}`), { ok: true }),
      kill: async (runId) => (calls.push(`kill:${runId}`), { ok: true }),
      steps: async () => (calls.push('steps'), []),
      stepStatuses: async () => (calls.push('stepStatuses'), { steps: [], truncated: false }),
      run: async () => (calls.push('run'), { id: 'run1' } as never),
    }))
    const app = asTask1()
    for (const runId of ['run2', 'nope']) {
      expect((await app.fetch(req(`/api/workflows/runs/${runId}`), {} as Env)).status).toBe(404)
      expect((await app.fetch(req(`/api/workflows/runs/${runId}/steps`), {} as Env)).status).toBe(404)
      expect((await app.fetch(req(`/api/workflows/runs/${runId}/step-statuses`), {} as Env)).status).toBe(404)
      expect((await app.fetch(req(`/api/workflows/runs/${runId}/gate`, 'POST', { stepId: 's', approved: true }), {} as Env)).status).toBe(404)
      expect((await app.fetch(req(`/api/workflows/runs/${runId}/cancel`, 'POST'), {} as Env)).status).toBe(404)
      expect((await app.fetch(req(`/api/workflows/runs/${runId}/kill`, 'POST', { stepId: 's' }), {} as Env)).status).toBe(404)
    }
    expect(calls).toEqual([])
    // Its own run still works.
    expect((await app.fetch(req('/api/workflows/runs/run1/cancel', 'POST'), {} as Env)).status).toBe(200)
    expect(calls).toEqual(['cancel:run1'])
  })

  it('reads its own run and treats unknown and foreign IDs the same', async () => {
    const run = vi.fn(async () => ({ id: 'run1', taskId: 'task1', name: 'Review', status: 'done' } as never))
    setWorkflowBridge(fake({ run }))
    const app = asTask1()
    expect(await (await app.fetch(req('/api/workflows/runs/run1'), {} as Env)).json()).toMatchObject({ id: 'run1', taskId: 'task1' })
    const unknown = await app.fetch(req('/api/workflows/runs/nope'), {} as Env)
    const foreign = await app.fetch(req('/api/workflows/runs/run2'), {} as Env)
    expect(unknown.status).toBe(404)
    expect(foreign.status).toBe(404)
    expect(await unknown.json()).toEqual(await foreign.json())
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('returns compact statuses under the same run guard', async () => {
    setWorkflowBridge(fake({ stepStatuses: async () => ({ steps: [{ id: 's1', status: 'waiting-gate' }], truncated: false }) }))
    expect(await (await asTask1().fetch(req('/api/workflows/runs/run1/step-statuses'), {} as Env)).json()).toEqual({ steps: [{ id: 's1', status: 'waiting-gate' }], truncated: false })
  })

  // Retry and gate are the run actions a confined caller may not take, even on its own run. Both move
  // a run past a check that exists to stop the agent: a retry would loop a failed step straight past
  // the rail that stopped it, and a gate answer would turn a human gate into no gate. Cancel and
  // kill stay open because both only stop work.
  it('cannot retry even its own run', async () => {
    const calls: string[] = []
    setWorkflowBridge(fake({ retry: async (runId) => (calls.push(`retry:${runId}`), { ok: true }) }))
    const res = await asTask1().fetch(req('/api/workflows/runs/run1/retry', 'POST', { stepId: 's' }), {} as Env)
    expect(res.status).toBe(403)
    expect(calls).toEqual([])
  })

  it('cannot approve or reject a gate even on its own run', async () => {
    const calls: string[] = []
    setWorkflowBridge(fake({ gate: async (runId) => (calls.push(`gate:${runId}`), { ok: true }) }))
    for (const approved of [true, false]) {
      const res = await asTask1().fetch(req('/api/workflows/runs/run1/gate', 'POST', { stepId: 's', approved }), {} as Env)
      expect(res.status).toBe(403)
    }
    expect(calls).toEqual([])
  })

  it('cannot read the node-wide run source directly', async () => {
    const allRuns = vi.fn(async () => ({ runs: [{ id: 'run2', taskId: 'task2' }] }))
    setWorkflowBridge(fake({ allRuns }))

    expect((await asTask1().fetch(req('/api/runs'), {} as Env)).status).toBe(403)
    expect(allRuns).not.toHaveBeenCalled()
  })

  it('still answers 503 rather than 404 when the runner is not wired', async () => {
    // dev:node's degraded mode must not be shadowed by the guard.
    expect((await asTask1().fetch(req('/api/workflows/runs/run2/cancel', 'POST'), {} as Env)).status).toBe(503)
  })
})


// The definitions store (docs/workflows.md § Database definitions). Writing one is authoring
// executable configuration, so the whole family is device-only.
describe('workflow definition routes', () => {
  afterEach(() => setWorkflowDefsBridge(null))

  const row = { id: 'def1', workspaceId: 'w1', projectId: null, name: 'Ship it', revision: 1, createdAt: 1, updatedAt: 1, def: { baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'Ship it', steps: [] } }

  const fakeDefs = (over: Partial<WorkflowDefsBridge> = {}): WorkflowDefsBridge => ({
    list: async () => ({ workflows: [], errors: [] }),
    get: async () => row,
    create: async () => ({ row }),
    update: async () => ({ row }),
    remove: async () => ({ ok: true }),
    validate: async () => ({ problems: [] }),
    saveToRepo: async () => ({ path: '.acorn/workflows/ship-it.toml' }),
    generate: async () => ({ def: row.def, notes: [], problems: [], repaired: false, providerId: 'anthropic', modelId: 'm' }),
    modelBackends: async () => [],
    ...over,
  })

  const defsApp = (principal: unknown) => {
    const app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => {
      c.set('principal', principal as never)
      await next()
    })
    return app.route('/api', workflowDefsRoutes)
  }
  const asDevice = () => defsApp({ kind: 'device', userId: 'james' })

  it('lets a device caller list, create, save and delete', async () => {
    const calls: string[] = []
    setWorkflowDefsBridge(fakeDefs({
      list: async (workspaceId) => (calls.push(`list:${workspaceId}`), { workflows: [], errors: [] }),
      create: async (input) => (calls.push(`create:${input.workspaceId}`), { row }),
      update: async (id, _def, revision) => (calls.push(`update:${id}:${revision}`), { row }),
      remove: async (id) => (calls.push(`remove:${id}`), { ok: true }),
    }))
    const app = asDevice()
    const def = { baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'Ship it', steps: [{ name: 's1' }] }
    expect((await app.fetch(req('/api/defs?workspaceId=w1'), {} as Env)).status).toBe(200)
    expect((await app.fetch(req('/api/defs', 'POST', { workspaceId: 'w1', def }), {} as Env)).status).toBe(200)
    expect((await app.fetch(req('/api/defs/def1', 'PUT', { def, revision: 3 }), {} as Env)).status).toBe(200)
    expect((await app.fetch(req('/api/defs/def1', 'DELETE'), {} as Env)).status).toBe(200)
    expect(calls).toEqual(['list:w1', 'create:w1', 'update:def1:3', 'remove:def1'])
  })

  it('admits a JSON definition only with the current baseline before calling the bridge', async () => {
    const received: unknown[] = []
    setWorkflowDefsBridge(fakeDefs({ create: async input => (received.push(input.def), { row }) }))
    const app = asDevice()
    const current = { baseline: 'acorn-1', formatVersion: 1, name: 'Current', steps: [] }
    const historical = { formatVersion: 1, name: 'Historical', steps: [] }
    const wrong = { ...current, baseline: 'other' }
    for (const def of [historical, wrong]) {
      expect((await app.fetch(req('/api/defs', 'POST', { workspaceId: 'w1', def }), {} as Env)).status).toBe(400)
      expect((await app.fetch(req('/api/defs/files', 'POST', { action: 'save', target: { projectId: 'p1', source: 'repo', path: '.acorn/workflows/example.toml' }, revision: 1, def }), {} as Env)).status).toBe(400)
    }
    expect(received).toEqual([])
    expect((await app.fetch(req('/api/defs', 'POST', JSON.parse(JSON.stringify({ workspaceId: 'w1', def: current }))), {} as Env)).status).toBe(200)
    expect(received).toEqual([current])
  })

  it('refuses every route to a task-confined caller', async () => {
    const calls: string[] = []
    setWorkflowDefsBridge(fakeDefs({ list: async () => (calls.push('list'), { workflows: [], errors: [] }) }))
    const app = defsApp({ kind: 'internal', userId: 'james', scope: 'task', taskId: 'task1' })
    const def = { baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'Ship it', steps: [{ name: 's1' }] }
    for (const call of [
      req('/api/defs?workspaceId=w1'),
      req('/api/defs', 'POST', { workspaceId: 'w1', def }),
      req('/api/defs/def1'),
      req('/api/defs/def1', 'PUT', { def, revision: 1 }),
      req('/api/defs/def1', 'DELETE'),
      req('/api/defs/validate', 'POST', { def }),
      req('/api/defs/generate', 'POST', { backendId: 'c1', description: 'two agents', workspaceId: 'w1' }),
      req('/api/defs/authoring/turn', 'POST', { target: 'workflow', scope: { workspaceId: 'w1' }, targetId: 'def1', baseRevision: 1, base: def, backendId: 'c1', instruction: 'Improve it.' }),
      req('/api/defs/def1/save-to-repo', 'POST', {}),
    ]) {
      expect((await app.fetch(call, {} as Env)).status).toBe(403)
    }
    expect(calls).toEqual([])
  })

  // A definition that does not validate is still storable, because that is every workflow partway
  // through being built (docs/workflows.md § Database definitions). Only a stale revision and a gone
  // row turn into a status here.
  it('stores a draft that does not validate, and 409s a stale revision and 404s a gone row', async () => {
    setWorkflowDefsBridge(fakeDefs({
      update: async () => ({ conflict: { ...row, revision: 4 } }),
      get: async () => null,
    }))
    const app = asDevice()
    const def = { baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'Untitled workflow', steps: [] }
    const created = await app.fetch(req('/api/defs', 'POST', { workspaceId: 'w1', def }), {} as Env)
    expect(created.status).toBe(200)
    const stale = await app.fetch(req('/api/defs/def1', 'PUT', { def, revision: 1 }), {} as Env)
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ error: { code: 'revision_conflict', details: { revision: 4 } } })
    expect((await app.fetch(req('/api/defs/def1'), {} as Env)).status).toBe(404)
  })

  it('400s a list with no workspace and a body that is not a definition, and 503s without a bridge', async () => {
    setWorkflowDefsBridge(fakeDefs())
    const app = asDevice()
    expect((await app.fetch(req('/api/defs'), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/defs', 'POST', { workspaceId: 'w1', def: { name: 'x' } }), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/defs/def1', 'PUT', { def: { baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'x', steps: [] } }), {} as Env)).status).toBe(400)
    setWorkflowDefsBridge(null)
    expect((await app.fetch(req('/api/defs?workspaceId=w1'), {} as Env)).status).toBe(503)
  })

  describe('AI authoring conversation', () => {
    const body = {
      target: 'workflow', scope: { workspaceId: 'w1', projectId: 'p1' }, targetId: 'def1', baseRevision: 1,
      base: row.def, backendId: 'harness:codex', instruction: 'Improve it.', context: [], samplesEnabled: false,
    }

    it('passes only a validated workflow turn and the interactive principal to the bridge', async () => {
      let seen: unknown
      setWorkflowDefsBridge(fakeDefs({
        author: async input => (seen = input, {
          state: 'clarification', question: 'Which outcome?', choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
          context: [], usage: { requests: 1, inputTokens: 2, outputTokens: 1 }, providerId: 'fake', modelId: 'm',
        }),
      }))
      const response = await asDevice().fetch(req('/api/defs/authoring/turn', 'POST', body), {} as Env)
      expect(response.status).toBe(200)
      expect(seen).toMatchObject({ ...body, userId: 'james', principal: { kind: 'device', userId: 'james' } })
    })

    it('rejects another target before reaching the bridge', async () => {
      const author = vi.fn()
      setWorkflowDefsBridge(fakeDefs({ author }))
      expect((await asDevice().fetch(req('/api/defs/authoring/turn', 'POST', { ...body, target: 'query' }), {} as Env)).status).toBe(400)
      expect(author).not.toHaveBeenCalled()
    })
  })

  // Generate spends the owner's provider key. The device gate above is what stands in front of it,
  // and `/defs/generate` has to be declared before `/defs/:id` or the parameter swallows the literal
  // and a generate reads a definition called "generate" instead.
  describe('generate', () => {
    const body = { mode: 'overwrite', backendId: 'c1', modelId: 'm', description: 'two agents and a synthesiser', workspaceId: 'w1', defId: 'def1' }

    it('reaches the bridge with the owner rather than the /defs/:id read', async () => {
      let seen: unknown
      setWorkflowDefsBridge(fakeDefs({
        get: async () => (seen = 'get', row),
        generate: async (input) => (seen = input, { def: row.def, notes: [], problems: [], repaired: false, providerId: 'anthropic', modelId: 'm' }),
      }))
      const res = await asDevice().fetch(req('/api/defs/generate', 'POST', body), {} as Env)
      expect(res.status).toBe(200)
      expect(seen).toEqual({ ...body, userId: 'james' })
    })

    it('400s a body with no description and 422s a reply that never became JSON', async () => {
      setWorkflowDefsBridge(fakeDefs({ generate: async () => ({ error: 'The model did not answer with JSON.' }) }))
      const app = asDevice()
      expect((await app.fetch(req('/api/defs/generate', 'POST', { backendId: 'c1', workspaceId: 'w1' }), {} as Env)).status).toBe(400)
      const res = await app.fetch(req('/api/defs/generate', 'POST', body), {} as Env)
      expect(res.status).toBe(422)
      expect(await res.text()).toContain('did not answer with JSON')
    })

    it('requires the current definition for edit mode', async () => {
      setWorkflowDefsBridge(fakeDefs())
      const app = asDevice()
      const withoutCurrent = { ...body, mode: 'edit' }
      expect((await app.fetch(req('/api/defs/generate', 'POST', withoutCurrent), {} as Env)).status).toBe(400)
      expect((await app.fetch(req('/api/defs/generate', 'POST', { ...withoutCurrent, currentDef: { baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'Broken', steps: [null] } }), {} as Env)).status).toBe(400)
      expect((await app.fetch(req('/api/defs/generate', 'POST', { ...withoutCurrent, currentDef: row.def }), {} as Env)).status).toBe(200)
    })

    it('answers a provider failure with the provider status', async () => {
      setWorkflowDefsBridge(fakeDefs({ generate: async () => { throw new ProviderOperationError('provider_needs_auth', 401) } }))
      const res = await asDevice().fetch(req('/api/defs/generate', 'POST', body), {} as Env)
      expect(res.status).toBe(401)
      expect(await res.json()).toMatchObject({ error: { code: 'provider_needs_auth' } })
    })
  })

  it('reports a save-to-repo refusal rather than pretending it wrote', async () => {
    setWorkflowDefsBridge(fakeDefs({ saveToRepo: async () => ({ error: 'That file would land outside the checkout.' }) }))
    const res = await asDevice().fetch(req('/api/defs/def1/save-to-repo', 'POST', { keepRow: true }), {} as Env)
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('outside the checkout')
  })
})
