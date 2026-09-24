import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentProfileRegistry, DEFAULT_PROFILE_ID } from '@acorn/plugin-api/node'
import { makeTestCoreServices, makeTestDb, makeTestPluginDb, schema as coreSchema, type TestDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import * as schema from '../node/schema'
import type { WorkflowDef } from '../shared/workflowContracts'
import { updateDef } from './workflowDefs'
import { createPublishedDef as createDef } from '../testkit/publishedDefinition'
import { resolveWorkflowGraph } from './workflowResolution'
import { WorkflowDispatcher } from './workflowDispatch'
import { WorkflowRunner, type RunnerDeps } from './workflowRunner'

const scope = { workspaceId: 'workspace', projectId: 'project', repoDir: null, userDir: null }
const result = (structuredOutput: unknown = null) => ({
  status: 'ok' as const, exitCode: 0,
  capture: { result: 'done', structuredOutput, sessionId: null, costUsd: 0.01, usage: { inputTokens: 1, outputTokens: 1 }, events: [] },
  stderrTail: '',
})
const leaf: WorkflowDef = {
  baseline: 'acorn-1' as const,
  formatVersion: 1 as const, name: 'Analyze',
  inputs: [{ name: 'record', schema: { type: 'object' }, required: true }],
  steps: [{ id: 'analyze', name: 'Analyze', prompt: 'Analyze the record.', schema: { type: 'object' } }],
  outputs: [{ name: 'answer', schema: { type: 'object' }, binding: { address: { from: 'step', stepId: 'analyze', pointer: '' } } }],
}
const childStep = (id: string) => ({
  id: 'follow', name: 'Follow up', kind: 'workflow',
  childWorkflow: { ref: { source: 'database' as const, id }, inputs: { record: { address: { from: 'input' as const, name: 'record', pointer: '' } } } },
})
const rootDefinition = (id: string): WorkflowDef => ({
  baseline: 'acorn-1' as const,
  formatVersion: 1 as const, name: 'Batch',
  steps: [
    { id: 'plan', name: 'Plan', prompt: 'Select records.', schema: { type: 'object' } },
    { id: 'each', name: 'For each', kind: 'workflow-map', items: { step: 'plan', pointer: '/items' }, itemKey: '/id',
      childWorkflow: { ref: { source: 'database', id }, inputs: { record: { address: { from: 'item', pointer: '' } } } },
      title: { template: 'Review ${id}', bindings: { id: { address: { from: 'item', pointer: '/id' } } } },
    },
    { id: 'summary', name: 'Summary', prompt: 'Summarize the child outcomes.', schema: { type: 'object' } },
  ],
})

describe('nested workflow execution', () => {
  let core: TestDb
  let store: TestPluginDb
  let runners: WorkflowRunner[]
  let unregister: () => void
  beforeEach(async () => {
    unregister = agentProfileRegistry.register({ id: DEFAULT_PROFILE_ID, label: 'Fixture', kind: 'agent', command: 'fixture', backendPreference: 'tmux', transport: 'pty' })
    core = makeTestDb()
    store = makeTestPluginDb('workflows')
    runners = []
    const at = Date.now()
    await core.db.insert(coreSchema.workspaces).values({ id: 'workspace', name: 'Workspace', isDefault: true, sort: 0, createdAt: at, updatedAt: at })
    await core.db.insert(coreSchema.projects).values({ id: 'project', name: 'Project', path: null, workspaceId: 'workspace', sort: 0, hidden: false, vcs: 'git', defaultBranch: 'main', createdAt: at, updatedAt: at })
    await core.db.insert(coreSchema.tasks).values({ id: 'task', title: 'Batch', origin: 'local', projectId: 'project', branch: 'batch', status: 'active', sort: 0, createdAt: at, updatedAt: at })
  })
  afterEach(async () => {
    for (const runner of runners) runner.stop()
    await new Promise(resolve => setTimeout(resolve, 20))
    store.cleanup()
    core.cleanup()
    unregister()
  })

  const save = (def: WorkflowDef) => createDef(store.db, { workspaceId: 'workspace', def })
  const makeRunner = (runStep: RunnerDeps['runStep'], taskCreation?: ReturnType<typeof makeTestCoreServices>['tasks']['createChild']) => {
    let dispatcher: WorkflowDispatcher
    const deps: RunnerDeps = {
      runStep, writeHandoff: async () => {}, assembleContext: async () => '', evaluatePolicy: async () => ({ pass: true }),
      failingChecks: async () => '', notify: vi.fn(),
      dispatchChildWorkflow: (request, signal) => dispatcher.dispatch(request, signal),
      dispatchChildWorkflows: (requests, signal) => dispatcher.dispatchMany(requests, signal),
    }
    const runner = new WorkflowRunner(store.db, deps)
    const tasks = makeTestCoreServices(core).tasks
    dispatcher = new WorkflowDispatcher(store.db, runner, { createChild: taskCreation ?? tasks.createChild })
    runners.push(runner)
    return { runner, dispatcher }
  }
  const start = async (runner: WorkflowRunner, root: WorkflowDef) => runner.start('task', root, {
    resolvedGraph: await resolveWorkflowGraph(store.db, root, { scope, catalog: runner.validationCatalog() }),
  })
  const settled = async (runner: WorkflowRunner, id: string, status: string, timeout = 20_000) => {
    await vi.waitFor(async () => expect((await runner.run(id))?.status).toBe(status), { timeout, interval: 10 })
  }

  it('runs conditional grandchildren from the root snapshot and keeps failures visible after a summary', async () => {
    const analysis = await save(leaf)
    const child: WorkflowDef = {
      ...leaf, name: 'Triage', outputs: undefined,
      steps: [
        { id: 'decide', name: 'Requires work', kind: 'if', condition: { kind: 'comparison', left: { address: { from: 'input', name: 'record', pointer: '/requiresWork' } }, operator: 'eq', right: { address: { from: 'literal', value: true } } }, branches: { true: 'follow', otherwise: 'skip' } },
        { ...childStep(analysis.id), after: ['decide'] },
        { id: 'skip', name: 'No follow-up', kind: 'gate-policy', policy: 'checks-green', after: ['decide'] },
      ],
    }
    const triage = await save(child)
    let calls = 0
    let summary = ''
    const { runner } = makeRunner(async (_task, def, opts) => {
      if (def.id === 'plan') {
        // A mutable definition edit after root admission cannot change grandchild execution.
        await updateDef(store.db, analysis.id, { ...leaf, steps: [{ id: 'changed', name: 'Changed', prompt: 'Changed.' }] }, analysis.revision)
        return result({ items: [{ id: 'a', requiresWork: true }, { id: 'b', requiresWork: false }, { id: 'c', requiresWork: true }] })
      }
      if (def.id === 'summary') { summary = opts.prompt; return result({ summarized: true }) }
      expect(def.id).toBe('analyze')
      calls++
      return calls === 1 ? { ...result(), status: 'error', stderrTail: 'Analysis failed.' } : result({ analyzed: true })
    })
    const id = await start(runner, rootDefinition(triage.id))
    await settled(runner, id, 'completed-with-failures')
    expect(calls).toBe(2)
    expect(summary).toContain('failed')
    const runs = await store.db.select().from(schema.workflowRuns)
    expect(runs.filter(run => run.depth === 1)).toHaveLength(3)
    expect(runs.filter(run => run.depth === 2)).toHaveLength(2)
    expect(runs.find(run => run.depth === 1 && run.status === 'done')).toBeDefined()
    expect(await core.db.select().from(coreSchema.tasks)).toHaveLength(6)
    const admissions = await store.db.select().from(schema.workflowTurnAdmissions)
    expect(admissions).toHaveLength(4) // Plan, two analyses, and the independent summary.
    expect(admissions.every(row => row.rootRunId === id)).toBe(true)
  })

  it('admits 500 descendants with four agent slots and ordered typed outcomes', async () => {
    const target = await save(leaf)
    let active = 0
    let peak = 0
    const { runner } = makeRunner(async (_task, def) => {
      if (def.id === 'plan') return result({ items: Array.from({ length: 500 }, (_, id) => ({ id })) })
      if (def.id === 'summary') return result({ summarized: true })
      peak = Math.max(peak, ++active)
      await new Promise(resolve => setTimeout(resolve, 1))
      active--
      return result({ analyzed: true })
    })
    const root = { ...rootDefinition(target.id), maxDescendants: 500 }
    const id = await start(runner, root)
    await settled(runner, id, 'done', 60_000)
    expect(peak).toBe(4)
    expect(await store.db.select().from(schema.workflowDispatches)).toHaveLength(500)
    expect(await core.db.select().from(coreSchema.tasks)).toHaveLength(501)
    const map = (await runner.steps(id)).find(step => step.kind === 'workflow-map')!
    const outcomes = JSON.parse(map.structuredJson!).children
    expect(outcomes).toHaveLength(500)
    expect(outcomes[0].itemKey).toBe('["number",0]')
    expect(outcomes[499].itemKey).toBe('["number",499]')
    expect(outcomes[499].outputs).toEqual({ answer: { analyzed: true } })
    expect(await store.db.select().from(schema.workflowTurnAdmissions)).toHaveLength(502)
  }, 75_000)

  it('retries only the failed grandchild and reopens its ancestors without duplicate tasks or charges', async () => {
    const target = await save(leaf)
    const middle = await save({ ...leaf, outputs: undefined, steps: [childStep(target.id)] })
    let fail = true
    const calls = new Map<string, number>()
    const { runner } = makeRunner(async (task, def) => {
      if (def.id === 'plan') return result({ items: [{ id: 'a' }, { id: 'b' }] })
      if (def.id === 'summary') return result({ summarized: true })
      calls.set(task, (calls.get(task) ?? 0) + 1)
      if (fail) { fail = false; return { ...result(), status: 'error', stderrTail: 'Try again explicitly.' } }
      return result({ analyzed: true })
    })
    const id = await start(runner, rootDefinition(middle.id))
    await settled(runner, id, 'completed-with-failures')
    const [failed] = (await store.db.select().from(schema.workflowRuns)).filter(run => run.depth === 2 && run.status === 'failed')
    const [step] = await runner.steps(failed!.id)
    const before = await store.db.select().from(schema.workflowDispatches)
    expect(await runner.retryStep(failed!.id, step!.id)).toEqual({ ok: true })
    await settled(runner, id, 'done')
    expect((await store.db.select().from(schema.workflowDispatches)).map(row => row.taskId).sort()).toEqual(before.map(row => row.taskId).sort())
    expect([...calls.values()].sort()).toEqual([1, 2])
    expect(await store.db.select().from(schema.workflowTurnAdmissions)).toHaveLength(5)
  })

  it('lets gated grandchildren coexist with running sibling work at root concurrency one', async () => {
    const target = await save({ ...leaf, steps: [{ id: 'gate', name: 'Approve', kind: 'gate-human' }, ...leaf.steps] })
    const middle = await save({ ...leaf, outputs: undefined, steps: [childStep(target.id)] })
    const { runner } = makeRunner(async (_task, def) => result(def.id === 'plan' ? { items: [{ id: 'a' }, { id: 'b' }] } : { analyzed: true }))
    const id = await start(runner, { ...rootDefinition(middle.id), maxConcurrency: 1 })
    await vi.waitFor(async () => expect((await store.db.select().from(schema.workflowRuns)).filter(run => run.depth === 2 && run.status === 'gated')).toHaveLength(2))
    const grandchildren = (await store.db.select().from(schema.workflowRuns)).filter(run => run.depth === 2)
    const firstGate = (await runner.steps(grandchildren[0]!.id))[0]!
    await runner.resolveGate(grandchildren[0]!.id, firstGate.id, true)
    await settled(runner, grandchildren[0]!.id, 'done')
    expect((await runner.run(id))?.status).toBe('gated')
    const secondGate = (await runner.steps(grandchildren[1]!.id))[0]!
    await runner.resolveGate(grandchildren[1]!.id, secondGate.id, true)
    await settled(runner, id, 'done')
  })

  it('keeps nested reserved identities across cancellation and restart after core task commit', async () => {
    const target = await save(leaf)
    const middle = await save({ ...leaf, outputs: undefined, steps: [childStep(target.id)] })
    const tasks = makeTestCoreServices(core).tasks
    let release!: () => void
    const paused = new Promise<void>(resolve => { release = resolve })
    let grandchildCommitted = false
    const first = makeRunner(async (_task, def) => result(def.id === 'plan' ? { items: [{ id: 'a' }] } : { analyzed: true }), async (parent, seed, intended) => {
      const task = await tasks.createChild(parent, seed, intended)
      if (parent !== 'task') { grandchildCommitted = true; await paused }
      return task
    })
    const id = await start(first.runner, rootDefinition(middle.id))
    await vi.waitFor(() => expect(grandchildCommitted).toBe(true))
    await first.runner.cancelRun(id)
    release()
    await settled(first.runner, id, 'cancelled')
    first.runner.stop()
    await new Promise(resolve => setTimeout(resolve, 20))
    const before = await store.db.select().from(schema.workflowDispatches)
    const restarted = makeRunner(async () => { throw new Error('Cancelled work must not restart.') })
    await restarted.dispatcher.reconcile()
    await restarted.runner.reconcile()
    expect((await store.db.select().from(schema.workflowDispatches)).map(row => row.taskId)).toEqual(before.map(row => row.taskId))
    expect(before.every(row => row.state === 'terminal')).toBe(true)
    expect(await core.db.select().from(coreSchema.tasks)).toHaveLength(3)
    expect(await store.db.select().from(schema.workflowTurnAdmissions)).toHaveLength(1)
  })

  it('stops a late nested admission at the root limit while an admitted sibling settles', async () => {
    const target = await save({ ...leaf, steps: [{ id: 'gate', name: 'Approve', kind: 'gate-human' }, ...leaf.steps] })
    const middle = await save({ ...leaf, outputs: undefined, steps: [childStep(target.id)] })
    const { runner } = makeRunner(async (_task, def) => result(def.id === 'plan' ? { items: [{ id: 'a' }, { id: 'b' }] } : { analyzed: true }))
    const id = await start(runner, { ...rootDefinition(middle.id), maxDescendants: 3 })
    await vi.waitFor(async () => expect((await store.db.select().from(schema.workflowRuns)).some(run => run.depth === 1 && run.status === 'safety-rail')).toBe(true))
    const grandchildren = (await store.db.select().from(schema.workflowRuns)).filter(run => run.depth === 2)
    expect(grandchildren).toHaveLength(1)
    expect(grandchildren[0]!.status).toBe('gated')
    expect((await runner.run(id))?.status).toBe('gated')
    const gate = (await runner.steps(grandchildren[0]!.id))[0]!
    await runner.resolveGate(grandchildren[0]!.id, gate.id, true)
    await settled(runner, grandchildren[0]!.id, 'done')
    await settled(runner, id, 'completed-with-failures')
    expect(await store.db.select().from(schema.workflowDispatches)).toHaveLength(3)
    expect(await core.db.select().from(coreSchema.tasks)).toHaveLength(4)
  })

  it('executes the fourth child level with frozen lineage and one root usage owner', async () => {
    let target = await save(leaf)
    for (let level = 1; level <= 3; level++) target = await save({ ...leaf, name: `Level ${level}`, outputs: undefined, steps: [childStep(target.id)] })
    const { runner } = makeRunner(async (_task, def) => result(def.id === 'plan' ? { items: [{ id: 'a' }] } : { analyzed: true }))
    const id = await start(runner, rootDefinition(target.id))
    await settled(runner, id, 'done')
    expect((await store.db.select().from(schema.workflowRuns)).map(run => run.depth).sort()).toEqual([0, 1, 2, 3, 4])
    const admissions = await store.db.select().from(schema.workflowTurnAdmissions)
    expect(admissions).toHaveLength(3)
    expect(admissions.every(row => row.rootRunId === id)).toBe(true)
  })

  it('rejects a late invalid typed child input before creating any task in the roster', async () => {
    const target = await save({ ...leaf, inputs: [{ name: 'record', required: true, schema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } }] })
    const { runner } = makeRunner(async () => result({ items: [{ id: 1 }, { id: 'invalid-number' }] }))
    const id = await start(runner, rootDefinition(target.id))
    await settled(runner, id, 'failed')
    expect(await store.db.select().from(schema.workflowDispatches)).toHaveLength(0)
    expect(await core.db.select().from(coreSchema.tasks)).toHaveLength(1)
  })
})
