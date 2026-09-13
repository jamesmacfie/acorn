import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { agentProfileRegistry, DEFAULT_PROFILE_ID } from '@acorn/plugin-api/node'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import * as schema from '../node/schema'
import type { ResolvedWorkflowGraph, WorkflowDef } from '../shared/workflowContracts'
import { WorkflowDispatcher } from './workflowDispatch'
import { WorkflowRunner, type RunnerDeps } from './workflowRunner'

const result = (structuredOutput: unknown = null) => ({
  status: 'ok' as const,
  exitCode: 0,
  capture: { result: 'done', structuredOutput, sessionId: null, costUsd: null, events: [] },
  stderrTail: '',
})

const childDefinition: WorkflowDef = {
  name: 'Review ticket',
  inputs: [
    { name: 'ticket', required: true },
    { name: 'queue', default: 'default-queue' },
  ],
  steps: [{ name: 'review', prompt: 'Review ${inputs.ticket} from ${inputs.queue}.', schema: { type: 'object' } }],
}

const mapDefinition = (): WorkflowDef => ({
  name: 'Ticket map',
  inputs: [{ name: 'queue', default: 'triage' }],
  steps: [
    { name: 'source', after: [], prompt: 'Select tickets.', schema: { type: 'object' } },
    {
      name: 'dispatch',
      kind: 'workflow-map',
      after: ['source'],
      childWorkflow: {
        ref: { source: 'database', id: 'child-def' },
        inputs: {
          ticket: { from: 'item', pointer: '/number' },
          queue: { from: 'input', name: 'queue' },
        },
      },
      items: { step: 'source', pointer: '/tickets' },
      itemKey: '/id',
      title: {
        template: 'Review ${ticket}',
        bindings: { ticket: { from: 'item', pointer: '/number' } },
      },
    },
  ],
})

const resolved = (root: WorkflowDef, child = childDefinition): ResolvedWorkflowGraph => ({
  root,
  nodes: [
    { path: ['$'], depth: 0, definition: root, provenance: { source: 'inline' }, defaultInputs: {}, fingerprint: 'root' },
    {
      path: ['$', 'dispatch'],
      depth: 1,
      definition: child,
      provenance: { source: 'database', id: 'child-def', revision: 1 },
      defaultInputs: { queue: 'default-queue' },
      fingerprint: 'child',
    },
  ],
  fingerprint: 'graph',
  requiresRepoTrust: false,
})

describe('workflow map lifecycle', () => {
  let store: TestPluginDb
  let runners: WorkflowRunner[]
  let taskIds: Set<string>
  let cancelledTasks: string[]
  let unregisterProfile: () => void

  beforeEach(() => {
    unregisterProfile = agentProfileRegistry.register({
      id: DEFAULT_PROFILE_ID,
      label: 'Claude Code',
      kind: 'agent',
      command: 'claude',
      backendPreference: 'tmux',
      transport: 'pty',
    })
    store = makeTestPluginDb('workflows')
    runners = []
    taskIds = new Set()
    cancelledTasks = []
  })

  afterEach(async () => {
    for (const runner of runners) runner.stop()
    await new Promise((resolve) => setTimeout(resolve, 10))
    store.cleanup()
    unregisterProfile()
  })

  const makeRunner = (
    tickets: unknown[],
    overrides: Partial<RunnerDeps> = {},
    createChild: (parentTaskId: string, seed: { title: string; branch: string }, intendedTaskId?: string) => Promise<string> = async (_parent, _seed, intended) => {
      taskIds.add(intended!)
      return intended!
    },
  ) => {
    let dispatcher: WorkflowDispatcher
    const deps: RunnerDeps = {
      runStep: async (_taskId, def) => result(def.name === 'source' ? { tickets } : { reviewed: def.name }),
      writeHandoff: async () => undefined,
      assembleContext: async () => '',
      evaluatePolicy: async () => ({ pass: true }),
      failingChecks: async () => '',
      notify: vi.fn(),
      cancelChildTask: async (taskId) => void cancelledTasks.push(taskId),
      runtimeWorkflowDispatchEnabled: true,
      ...overrides,
      dispatchChildWorkflow: (request, signal) => dispatcher.dispatch(request, signal),
      dispatchChildWorkflows: (requests, signal) => dispatcher.dispatchMany(requests, signal),
    }
    const runner = new WorkflowRunner(store.db, deps)
    dispatcher = new WorkflowDispatcher(store.db, runner, {
      createChild,
    })
    runners.push(runner)
    return { runner, dispatcher }
  }

  const waitForRun = async (runner: WorkflowRunner, runId: string, statuses: string[]) => {
    await vi.waitFor(async () => expect(statuses).toContain((await runner.run(runId))?.status), { timeout: 10_000 })
    return (await runner.run(runId))!
  }

  it.each([0, 1, 12])('maps %i structured items in source order', async (count) => {
    const tickets = Array.from({ length: count }, (_, index) => ({ id: `id-${index}`, number: `ABC-${index + 1}` }))
    const prompts: string[] = []
    const { runner } = makeRunner(tickets, {
      runStep: async (_taskId, def, opts) => {
        if (def.name === 'source') return result({ tickets })
        prompts.push(opts.prompt)
        return result({ reviewed: opts.prompt })
      },
    })
    const root = mapDefinition()
    const runId = await runner.start('parent-task', root, { resolvedGraph: resolved(root) })

    expect((await waitForRun(runner, runId, ['done'])).status).toBe('done')
    const mapStep = (await runner.steps(runId)).find((step) => step.name === 'dispatch')!
    const summaries = await runner.childRuns(mapStep.id)
    expect(summaries.map((summary) => summary.itemKey)).toEqual(tickets.map((ticket) => ticket.id))
    expect(summaries.every((summary) => summary.runStatus === 'done')).toBe(true)
    expect(prompts).toEqual(tickets.map((ticket) => `Review ${ticket.number} from triage.`))
    expect(taskIds.size).toBe(count)
    expect(JSON.parse(mapStep.structuredJson!)).toEqual({ children: summaries })
  })

  it('refuses 13 items before it reserves or creates any child', async () => {
    const tickets = Array.from({ length: 13 }, (_, index) => ({ id: `id-${index}`, number: `ABC-${index + 1}` }))
    const createChild = vi.fn(async (_parent: string, _seed: { title: string; branch: string }, intended?: string) => intended!)
    const { runner } = makeRunner(tickets, {}, createChild)
    const root = mapDefinition()
    const runId = await runner.start('parent-task', root, { resolvedGraph: resolved(root) })

    expect((await waitForRun(runner, runId, ['safety-rail'])).error).toContain('12-task descendant limit')
    expect(createChild).not.toHaveBeenCalled()
    expect(await store.db.select().from(schema.workflowDispatches)).toEqual([])
  })

  it('validates the complete roster before it creates a child', async () => {
    const tickets = [
      { id: 'same', number: 'ABC-1' },
      { id: 'same', number: 'ABC-2' },
    ]
    const createChild = vi.fn(async (_parent: string, _seed: { title: string; branch: string }, intended?: string) => intended!)
    const { runner } = makeRunner(tickets, {}, createChild)
    const root = mapDefinition()
    const runId = await runner.start('parent-task', root, { resolvedGraph: resolved(root) })

    expect((await waitForRun(runner, runId, ['failed'])).error).toContain("item key 'same' is repeated")
    expect(createChild).not.toHaveBeenCalled()
    expect(await store.db.select().from(schema.workflowDispatches)).toEqual([])
  })

  it('waits for every admitted child before a partial failure fails the map', async () => {
    const tickets = [
      { id: 'one', number: 'ABC-1' },
      { id: 'two', number: 'ABC-2' },
      { id: 'three', number: 'ABC-3' },
    ]
    const seen: string[] = []
    const { runner } = makeRunner(tickets, {
      runStep: async (_taskId, def, opts) => {
        if (def.name === 'source') return result({ tickets })
        seen.push(opts.prompt)
        return opts.prompt.includes('ABC-2')
          ? { ...result(), status: 'error' as const, exitCode: 1, stderrTail: 'ticket review failed' }
          : result({ reviewed: opts.prompt })
      },
    })
    const root = mapDefinition()
    const runId = await runner.start('parent-task', root, { resolvedGraph: resolved(root) })

    expect((await waitForRun(runner, runId, ['failed'])).error).toContain('1 failed child')
    expect(seen).toHaveLength(3)
    const children = await store.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.parentRunId, runId))
    expect(children.map((run) => run.status).sort()).toEqual(['done', 'done', 'failed'])
  })

  it('publishes ordered structured summaries to a downstream step', async () => {
    const tickets = [{ id: 'one', number: 'ABC-1' }, { id: 'two', number: 'ABC-2' }]
    let downstreamPrompt = ''
    const { runner } = makeRunner(tickets, {
      runStep: async (_taskId, def, opts) => {
        if (def.name === 'source') return result({ tickets })
        if (def.name === 'summarize') downstreamPrompt = opts.prompt
        return result()
      },
    })
    const root = mapDefinition()
    root.steps.push({
      name: 'summarize',
      after: ['dispatch'],
      inputs: 'template',
      prompt: 'Children: ${steps.dispatch.output}',
    })
    const runId = await runner.start('parent-task', root, { resolvedGraph: resolved(root) })

    expect((await waitForRun(runner, runId, ['done'])).status).toBe('done')
    expect(downstreamPrompt).toContain('"itemKey":"one"')
    expect(downstreamPrompt.indexOf('"itemKey":"one"')).toBeLessThan(downstreamPrompt.indexOf('"itemKey":"two"'))
  })

  it('uses the frozen roster when predecessor output changes before restart recovery', async () => {
    const firstTickets = [{ id: 'one', number: 'ABC-1' }]
    const child: WorkflowDef = {
      ...childDefinition,
      steps: [
        { name: 'approve', kind: 'gate-human' },
        { name: 'review', prompt: 'Review ${inputs.ticket} from ${inputs.queue}.' },
      ],
    }
    const root = mapDefinition()
    const first = makeRunner(firstTickets)
    const runId = await first.runner.start('parent-task', root, { resolvedGraph: resolved(root, child) })
    await waitForRun(first.runner, runId, ['gated'])
    first.runner.stop()

    const [source] = await store.db.select().from(schema.workflowSteps)
      .where(eq(schema.workflowSteps.name, 'source'))
    await store.db.update(schema.workflowSteps)
      .set({ structuredJson: JSON.stringify({ tickets: [{ id: 'changed', number: 'ABC-99' }] }) })
      .where(eq(schema.workflowSteps.id, source!.id))

    const prompts: string[] = []
    const recovered = makeRunner([], {
      runStep: async (_taskId, _def, opts) => {
        prompts.push(opts.prompt)
        return result()
      },
    })
    await recovered.dispatcher.reconcile()
    await recovered.runner.reconcile()
    const [childRun] = await store.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.parentRunId, runId))
    const [gate] = await recovered.runner.steps(childRun!.id)
    await recovered.runner.resolveGate(childRun!.id, gate!.id, true)

    expect((await waitForRun(recovered.runner, runId, ['done'])).status).toBe('done')
    expect(prompts[0]).toContain('Review ABC-1 from triage.')
    expect(prompts[0]).not.toContain('ABC-99')
    expect(taskIds.size).toBe(1)
  })

  it('deduplicates concurrent recovery of one frozen map roster', async () => {
    const tickets = [{ id: 'one', number: 'ABC-1' }]
    const child: WorkflowDef = { ...childDefinition, steps: [{ name: 'approve', kind: 'gate-human' }] }
    const root = mapDefinition()
    const first = makeRunner(tickets)
    const runId = await first.runner.start('parent-task', root, { resolvedGraph: resolved(root, child) })
    await waitForRun(first.runner, runId, ['gated'])
    first.runner.stop()

    const left = makeRunner([])
    const right = makeRunner([])
    await Promise.all([
      left.dispatcher.reconcile().then(() => left.runner.reconcile()),
      right.dispatcher.reconcile().then(() => right.runner.reconcile()),
    ])
    const [childRun] = await store.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.parentRunId, runId))
    const [gate] = await left.runner.steps(childRun!.id)
    await left.runner.resolveGate(childRun!.id, gate!.id, true)

    expect((await waitForRun(left.runner, runId, ['done'])).status).toBe('done')
    expect(await store.db.select().from(schema.workflowDispatches)).toHaveLength(1)
    expect(taskIds.size).toBe(1)
  })

  it('cancels reservations and retains tasks created while cancellation interrupts admission', async () => {
    const tickets = [{ id: 'one', number: 'ABC-1' }, { id: 'two', number: 'ABC-2' }]
    let releaseSecond = () => {}
    const secondBlocked = new Promise<void>((resolve) => { releaseSecond = resolve })
    let calls = 0
    const createChild = vi.fn(async (_parent: string, _seed: { title: string; branch: string }, intended?: string) => {
      calls += 1
      if (calls === 2) await secondBlocked
      taskIds.add(intended!)
      return intended!
    })
    const child: WorkflowDef = { ...childDefinition, steps: [{ name: 'approve', kind: 'gate-human' }] }
    const { runner } = makeRunner(tickets, {}, createChild)
    const root = mapDefinition()
    const runId = await runner.start('parent-task', root, { resolvedGraph: resolved(root, child) })
    await vi.waitFor(() => expect(createChild).toHaveBeenCalledTimes(2))

    await runner.cancelRun(runId)
    releaseSecond()
    await vi.waitFor(async () => {
      const dispatches = await store.db.select().from(schema.workflowDispatches)
      expect(dispatches).toHaveLength(2)
      expect(dispatches.every((dispatch) => dispatch.state === 'terminal')).toBe(true)
    })

    expect((await runner.run(runId))?.status).toBe('cancelled')
    expect(taskIds.size).toBe(2)
    expect(cancelledTasks).toEqual([])
  })
})
