import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { requireUser } from '@acorn/node-core/server/middleware/requireUser.ts'
import { ProviderOperationError } from '@acorn/plugin-api/node'
import { workflow, setWorkflowBridge, type WorkflowBridge } from './workflow'
import { setWorkflowDefsBridge, workflowDefsRoutes, type WorkflowDefsBridge } from './defs'
import type { Env } from '@acorn/node-core/server/bindings.ts'

// Workflow start/gate execute an agent step, so the route test proves body validation, auth, and
// the bridge-unavailable 503 (the privileged-boundary contract). The runner logic is tested in
// ../workflowRunner.test.ts.

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
  steps: async () => [],
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

  it('carries the start body\'s inputs to the runner and refuses a value that is not a string', async () => {
    let seen: unknown = 'unset'
    setWorkflowBridge(fake({ start: async (_t, _def, inputs) => ((seen = inputs), { runId: 'run1' }) }))
    const app = authed()
    const def = { name: 'W', steps: [{ name: 's1' }] }
    expect((await app.fetch(req('/api/tasks/task1/workflows', 'POST', { def, inputs: { issue: 'It crashes' } }), {} as Env)).status).toBe(200)
    expect(seen).toEqual({ issue: 'It crashes' })
    // Absent is not the same as empty: which names are allowed is the runner's answer, not the route's.
    await app.fetch(req('/api/tasks/task1/workflows', 'POST', { def }), {} as Env)
    expect(seen).toBeUndefined()
    expect((await app.fetch(req('/api/tasks/task1/workflows', 'POST', { def, inputs: { issue: 12 } }), {} as Env)).status).toBe(400)
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
    const def = { name: 'W', steps: [{ name: 's1' }] }
    expect((await app.fetch(req('/api/tasks/task1/workflows', 'POST', { def, defId: 'repo:ship' }), {} as Env)).status).toBe(400)
  })

  // A row skips the repo trust snapshot because it has no committed bytes to hash. An agent inside the
  // task may still start a file, which the snapshot does cover.
  it('lets a task-confined caller start a file by id but never a row', async () => {
    const started: string[] = []
    setWorkflowBridge(fake({ startById: async (_t, defId) => (started.push(defId), { runId: 'run1' }) }))
    const app = asTask1()
    expect((await app.fetch(req('/api/tasks/task1/workflows', 'POST', { defId: 'repo:ship' }), {} as Env)).status).toBe(200)
    expect((await app.fetch(req('/api/tasks/task1/workflows', 'POST', { defId: 'user:ship' }), {} as Env)).status).toBe(200)
    expect((await app.fetch(req('/api/tasks/task1/workflows', 'POST', { defId: 'a-row-uuid' }), {} as Env)).status).toBe(403)
    expect(started).toEqual(['repo:ship', 'user:ship'])
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

  // Retry is the one run action a confined caller may not take, even on its own run: an agent could
  // otherwise loop a failed step straight past the rail that stopped it.
  it('cannot retry even its own run', async () => {
    const calls: string[] = []
    setWorkflowBridge(fake({ retry: async (runId) => (calls.push(`retry:${runId}`), { ok: true }) }))
    const res = await asTask1().fetch(req('/api/workflows/runs/run1/retry', 'POST', { stepId: 's' }), {} as Env)
    expect(res.status).toBe(403)
    expect(calls).toEqual([])
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

  const row = { id: 'def1', workspaceId: 'w1', projectId: null, name: 'Ship it', revision: 1, createdAt: 1, updatedAt: 1, def: { name: 'Ship it', steps: [] } }

  const fakeDefs = (over: Partial<WorkflowDefsBridge> = {}): WorkflowDefsBridge => ({
    list: async () => ({ workflows: [], errors: [] }),
    get: async () => row,
    create: async () => ({ row }),
    update: async () => ({ row }),
    remove: async () => ({ ok: true }),
    validate: async () => ({ problems: [] }),
    saveToRepo: async () => ({ path: '.acorn/workflows/ship-it.toml' }),
    generate: async () => ({ def: row.def, notes: [], problems: [], repaired: false, providerId: 'anthropic', modelId: 'm' }),
    modelConnections: async () => [],
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
    const def = { name: 'Ship it', steps: [{ name: 's1' }] }
    expect((await app.fetch(req('/api/defs?workspaceId=w1'), {} as Env)).status).toBe(200)
    expect((await app.fetch(req('/api/defs', 'POST', { workspaceId: 'w1', def }), {} as Env)).status).toBe(200)
    expect((await app.fetch(req('/api/defs/def1', 'PUT', { def, revision: 3 }), {} as Env)).status).toBe(200)
    expect((await app.fetch(req('/api/defs/def1', 'DELETE'), {} as Env)).status).toBe(200)
    expect(calls).toEqual(['list:w1', 'create:w1', 'update:def1:3', 'remove:def1'])
  })

  it('refuses every route to a task-confined caller', async () => {
    const calls: string[] = []
    setWorkflowDefsBridge(fakeDefs({ list: async () => (calls.push('list'), { workflows: [], errors: [] }) }))
    const app = defsApp({ kind: 'internal', userId: 'james', scope: 'task', taskId: 'task1' })
    const def = { name: 'Ship it', steps: [{ name: 's1' }] }
    for (const call of [
      req('/api/defs?workspaceId=w1'),
      req('/api/defs', 'POST', { workspaceId: 'w1', def }),
      req('/api/defs/def1'),
      req('/api/defs/def1', 'PUT', { def, revision: 1 }),
      req('/api/defs/def1', 'DELETE'),
      req('/api/defs/validate', 'POST', { def }),
      req('/api/defs/generate', 'POST', { connectionId: 'c1', description: 'two agents', workspaceId: 'w1' }),
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
    const def = { name: 'Untitled workflow', steps: [] }
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
    expect((await app.fetch(req('/api/defs/def1', 'PUT', { def: { name: 'x', steps: [] } }), {} as Env)).status).toBe(400)
    setWorkflowDefsBridge(null)
    expect((await app.fetch(req('/api/defs?workspaceId=w1'), {} as Env)).status).toBe(503)
  })

  // Generate spends the owner's provider key. The device gate above is what stands in front of it,
  // and `/defs/generate` has to be declared before `/defs/:id` or the parameter swallows the literal
  // and a generate reads a definition called "generate" instead.
  describe('generate', () => {
    const body = { connectionId: 'c1', modelId: 'm', description: 'two agents and a synthesiser', workspaceId: 'w1', defId: 'def1' }

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
      expect((await app.fetch(req('/api/defs/generate', 'POST', { connectionId: 'c1', workspaceId: 'w1' }), {} as Env)).status).toBe(400)
      const res = await app.fetch(req('/api/defs/generate', 'POST', body), {} as Env)
      expect(res.status).toBe(422)
      expect(await res.text()).toContain('did not answer with JSON')
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
