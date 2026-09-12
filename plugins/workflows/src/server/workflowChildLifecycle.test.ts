import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { agentProfileRegistry, DEFAULT_PROFILE_ID } from '@acorn/plugin-api/node'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import * as schema from '../node/schema'
import type { ResolvedWorkflowGraph, WorkflowDef } from '../shared/workflowContracts'
import { WorkflowChildLifecycle } from './workflowChildLifecycle'
import { WorkflowDispatcher } from './workflowDispatch'
import { WorkflowRunner, type RunnerDeps } from './workflowRunner'

const result = (structuredOutput: unknown = null) => ({
  status: 'ok' as const,
  exitCode: 0,
  capture: {
    result: 'done',
    structuredOutput,
    sessionId: null,
    costUsd: null,
    events: [],
  },
  stderrTail: '',
})

const resolved = (root: WorkflowDef, child: WorkflowDef): ResolvedWorkflowGraph => ({
  root,
  nodes: [
    { path: ['$'], depth: 0, definition: root, provenance: { source: 'inline' }, defaultInputs: {}, fingerprint: 'root' },
    { path: ['$', 'dispatch'], depth: 1, definition: child, provenance: { source: 'database', id: 'child-def', revision: 1 }, defaultInputs: {}, fingerprint: 'child' },
  ],
  fingerprint: 'graph',
  requiresRepoTrust: false,
})

const rootDefinition = (tail = true): WorkflowDef => ({
  name: 'Parent run',
  inputs: [{ name: 'fallback', default: 'ABC-0' }],
  steps: [
    { name: 'source', after: [], prompt: 'Find the ticket.', schema: { type: 'object' } },
    {
      name: 'dispatch',
      kind: 'workflow',
      after: ['source'],
      childWorkflow: {
        ref: { source: 'database', id: 'child-def' },
        inputs: { ticket: { from: 'step', step: 'source', pointer: '/ticket' } },
      },
    },
    ...(tail ? [{ name: 'after-child', after: ['dispatch'], prompt: 'Summarize.' }] : []),
  ],
})

describe('single-child workflow lifecycle', () => {
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
    overrides: Partial<RunnerDeps> = {},
    createChild: (parentTaskId: string, seed: { title: string; branch: string }, intendedTaskId?: string) => Promise<string> = async (_parent, _seed, intended) => {
      taskIds.add(intended!)
      return intended!
    },
  ) => {
    let dispatcher: WorkflowDispatcher
    const deps: RunnerDeps = {
      runStep: async (_taskId, def) => result(def.name === 'source' ? { ticket: 'ABC-7' } : null),
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
    return { runner, dispatcher, deps }
  }

  const waitForRun = async (runner: WorkflowRunner, runId: string, statuses: string[]) => {
    await vi.waitFor(async () => expect(statuses).toContain((await runner.run(runId))?.status))
    return (await runner.run(runId))!
  }

  const childRun = async (parentRunId: string) => {
    await vi.waitFor(async () => {
      const rows = await store.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.parentRunId, parentRunId))
      expect(rows).toHaveLength(1)
    })
    return (await store.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.parentRunId, parentRunId)))[0]!
  }

  it('passes bound inputs, completes the parent graph, and publishes a bounded terminal summary', async () => {
    const seen: { taskId: string; prompt: string; tools: unknown }[] = []
    const childChanged = vi.fn()
    const { runner } = makeRunner({
      childChanged,
      runStep: async (taskId, def, opts) => {
        seen.push({ taskId, prompt: opts.prompt, tools: opts.tools })
        return result(def.name === 'source' ? { ticket: 'ABC-7' } : def.name === 'review' ? { reviewed: 'ABC-7' } : null)
      },
    })
    const child: WorkflowDef = {
      name: 'Child review',
      tools: { allow: ['notes_list', 'task_current'], maxRisk: 'write' },
      inputs: [{ name: 'ticket', required: true }],
      steps: [{ name: 'review', prompt: 'Review ${inputs.ticket}.', schema: { type: 'object' } }],
    }
    const root = rootDefinition()
    root.tools = { allow: ['notes_list', 'task_current', 'notes_write'], maxRisk: 'write' }
    root.steps.find((step) => step.name === 'dispatch')!.tools = { allow: ['notes_list'], maxRisk: 'read' }
    const runId = await runner.start('parent-task', root, { resolvedGraph: resolved(root, child) })

    expect((await waitForRun(runner, runId, ['done'])).status).toBe('done')
    const childRow = await childRun(runId)
    expect(seen).toContainEqual({
      taskId: childRow.taskId,
      prompt: 'Review ABC-7.',
      tools: { allow: ['notes_list'], maxRisk: 'read' },
    })
    expect(JSON.parse(childRow.effectiveToolsJson)).toEqual({ allow: ['notes_list'], maxRisk: 'read' })
    expect(taskIds).toEqual(new Set([childRow.taskId]))
    expect((await runner.steps(runId)).map((step) => [step.name, step.status])).toEqual([
      ['source', 'done'],
      ['dispatch', 'done'],
      ['after-child', 'done'],
    ])
    const dispatchStep = (await runner.steps(runId))[1]!
    const [summary] = await runner.childRuns(dispatchStep.id)
    expect(summary).toMatchObject({ taskId: childRow.taskId, runId: childRow.id, dispatchState: 'terminal', runStatus: 'done' })
    expect(summary.resultSummary?.length).toBeLessThanOrEqual(2_000)
    expect(childChanged).toHaveBeenCalledWith(expect.objectContaining({
      ownerTaskId: 'parent-task',
      taskId: expect.any(String),
      runStatus: 'done',
    }))
  })

  it('preserves child failure detail and reuses the same task and run when the parent step is retried', async () => {
    const { runner } = makeRunner({
      runStep: async (_taskId, def) => def.name === 'source'
        ? result({ ticket: 'ABC-7' })
        : { ...result(), status: 'error' as const, exitCode: 1, stderrTail: 'review failed' },
    })
    const child: WorkflowDef = { name: 'Child review', inputs: [{ name: 'ticket', required: true }], steps: [{ name: 'review' }] }
    const root = rootDefinition(false)
    const runId = await runner.start('parent-task', root, { resolvedGraph: resolved(root, child) })

    const failed = await waitForRun(runner, runId, ['failed'])
    expect(failed.error).toContain('review failed')
    const dispatchStep = (await runner.steps(runId)).find((step) => step.name === 'dispatch')!
    const before = await runner.childRuns(dispatchStep.id)
    expect(await runner.retryStep(runId, dispatchStep.id)).toEqual({ ok: true })
    await waitForRun(runner, runId, ['failed'])
    const after = await runner.childRuns(dispatchStep.id)
    expect(after.map(({ taskId, runId: childRunId }) => [taskId, childRunId]))
      .toEqual(before.map(({ taskId, runId: childRunId }) => [taskId, childRunId]))
    expect(taskIds.size).toBe(1)
  })

  it('restores a gated child wait after restart and continues when the child gate is approved', async () => {
    const child: WorkflowDef = {
      name: 'Gated child',
      inputs: [{ name: 'ticket', required: true }],
      steps: [{ name: 'approve', kind: 'gate-human' }, { name: 'finish', prompt: 'Finish.' }],
    }
    const root = rootDefinition(false)
    const first = makeRunner()
    const parentRunId = await first.runner.start('parent-task', root, { resolvedGraph: resolved(root, child) })
    await waitForRun(first.runner, parentRunId, ['gated'])
    const childBefore = await childRun(parentRunId)
    expect(childBefore.status).toBe('gated')
    first.runner.stop()

    const revived = makeRunner()
    await revived.dispatcher.reconcile()
    await revived.runner.reconcile()
    await waitForRun(revived.runner, parentRunId, ['gated'])
    const [gate] = await revived.runner.steps(childBefore.id)
    await revived.runner.resolveGate(childBefore.id, gate!.id, true)

    expect((await waitForRun(revived.runner, parentRunId, ['done'])).status).toBe('done')
    expect((await childRun(parentRunId)).id).toBe(childBefore.id)
    expect(taskIds.size).toBe(1)
  })

  it('keeps the parent gated when a child finishes beside a parent gate', async () => {
    const child: WorkflowDef = { name: 'Child', steps: [{ name: 'finish', prompt: 'Finish.' }] }
    const root: WorkflowDef = {
      name: 'Parallel gates',
      steps: [
        { name: 'approve-parent', kind: 'gate-human', after: [] },
        {
          name: 'dispatch',
          kind: 'workflow',
          after: [],
          childWorkflow: { ref: { source: 'database', id: 'child-def' } },
        },
      ],
    }
    const { runner } = makeRunner()
    const runId = await runner.start('parent-task', root, { resolvedGraph: resolved(root, child) })
    const childRow = await childRun(runId)

    await waitForRun(runner, childRow.id, ['done'])
    expect((await runner.run(runId))?.status).toBe('gated')
    const gate = (await runner.steps(runId)).find((step) => step.name === 'approve-parent')!
    await runner.resolveGate(runId, gate.id, true)

    expect((await waitForRun(runner, runId, ['done'])).status).toBe('done')
  })

  it('recovers a waiting parent from an already-terminal child without creating another invocation', async () => {
    const child: WorkflowDef = {
      name: 'Gated child',
      inputs: [{ name: 'ticket', required: true }],
      steps: [{ name: 'approve', kind: 'gate-human' }, { name: 'finish', prompt: 'Finish.' }],
    }
    const root = rootDefinition(false)
    const first = makeRunner()
    const parentRunId = await first.runner.start('parent-task', root, { resolvedGraph: resolved(root, child) })
    await waitForRun(first.runner, parentRunId, ['gated'])
    const childBefore = await childRun(parentRunId)
    first.runner.stop()

    const childFinisher = makeRunner()
    const [gate] = await childFinisher.runner.steps(childBefore.id)
    await childFinisher.runner.resolveGate(childBefore.id, gate!.id, true)
    await waitForRun(childFinisher.runner, childBefore.id, ['done'])
    childFinisher.runner.stop()

    const recovered = makeRunner()
    await recovered.dispatcher.reconcile()
    await recovered.runner.reconcile()

    expect((await waitForRun(recovered.runner, parentRunId, ['done'])).status).toBe('done')
    expect((await childRun(parentRunId)).id).toBe(childBefore.id)
    expect(taskIds.size).toBe(1)
  })

  it('treats duplicate terminal wake-ups as hints and settles from the durable child row once', async () => {
    const root: WorkflowDef = {
      name: 'Parent',
      steps: [{
        name: 'dispatch',
        kind: 'workflow',
        childWorkflow: { ref: { source: 'database', id: 'child-def' } },
      }],
    }
    const child: WorkflowDef = { name: 'Child', steps: [] }
    const at = Date.now()
    await store.db.insert(schema.workflowRuns).values([
      {
        id: 'parent-run', taskId: 'parent-task', name: root.name, status: 'running', posture: 'gated',
        trigger: 'manual', defJson: JSON.stringify(root), resolvedGraphJson: JSON.stringify(resolved(root, child)),
        rootRunId: 'parent-run', depth: 0, createdAt: at, updatedAt: at,
      },
      {
        id: 'child-run', taskId: 'child-task', name: child.name, status: 'running', posture: 'gated',
        trigger: 'manual', defJson: JSON.stringify(child), rootRunId: 'parent-run', parentRunId: 'parent-run',
        parentStepId: 'parent-step', depth: 1, invocationKey: 'parent-run:parent-step:single',
        payloadFingerprint: 'payload', createdAt: at, updatedAt: at,
      },
    ])
    await store.db.insert(schema.workflowSteps).values({
      id: 'parent-step', runId: 'parent-run', idx: 0, name: 'dispatch', kind: 'workflow', mode: 'headless',
      status: 'running', createdAt: at, updatedAt: at,
    })
    await store.db.insert(schema.workflowDispatches).values({
      id: 'dispatch', callerKey: 'parent-run:parent-step:single', payloadFingerprint: 'payload', payloadJson: '{}',
      parentTaskId: 'parent-task', taskId: 'child-task', runId: 'child-run', rootRunId: 'parent-run',
      parentRunId: 'parent-run', parentStepId: 'parent-step', state: 'run-started', createdAt: at, updatedAt: at,
    })
    const [parentRun] = await store.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.id, 'parent-run'))
    const [parentStep] = await store.db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.id, 'parent-step'))
    const childChanged = vi.fn()
    const lifecycle = new WorkflowChildLifecycle(store.db, {
      dispatch: async () => ({ taskId: 'child-task', runId: 'child-run', state: 'run-started' }),
      dispatchMany: async () => [],
      steps: async (runId) => store.db.select().from(schema.workflowSteps).where(eq(schema.workflowSteps.runId, runId)),
      setStep: async (stepId, patch) => {
        await store.db.update(schema.workflowSteps).set({ ...patch, updatedAt: Date.now() }).where(eq(schema.workflowSteps.id, stepId))
      },
      setParentStatus: async (runId, status) => {
        await store.db.update(schema.workflowRuns).set({ status, updatedAt: Date.now() }).where(eq(schema.workflowRuns.id, runId))
      },
      childChanged,
    })
    const controller = new AbortController()
    const outcome = lifecycle.handler()({
      run: parentRun!,
      step: parentStep!,
      def: root.steps[0]!,
      renderedPrompt: '',
      tools: {},
      budget: {},
      signal: controller.signal,
      inputs: {},
      upstream: [],
      emit: () => undefined,
    })
    await vi.waitFor(async () => expect((await store.db.select().from(schema.workflowSteps)
      .where(eq(schema.workflowSteps.id, 'parent-step')))[0]?.status).toBe('waiting-children'))

    await store.db.update(schema.workflowRuns).set({ status: 'done', updatedAt: Date.now() })
      .where(eq(schema.workflowRuns.id, 'child-run'))
    await Promise.all([lifecycle.publish('child-run'), lifecycle.publish('child-run')])

    await expect(outcome).resolves.toMatchObject({ status: 'done' })
    const [dispatch] = await store.db.select().from(schema.workflowDispatches)
    expect(dispatch.state).toBe('terminal')
    expect(childChanged.mock.calls.filter(([event]) => event.runStatus === 'done').length).toBeGreaterThanOrEqual(2)
  })

  it('stops admission during reservation and retains a task that commits while cancellation waits', async () => {
    let releaseCreation = () => {}
    const creating = new Promise<void>((resolve) => { releaseCreation = resolve })
    const createChild = vi.fn(async (_parent: string, _seed: { title: string; branch: string }, intended?: string) => {
      await creating
      taskIds.add(intended!)
      return intended!
    })
    const child: WorkflowDef = { name: 'Child', inputs: [{ name: 'ticket', required: true }], steps: [{ name: 'work' }] }
    const root = rootDefinition(false)
    const { runner } = makeRunner({}, createChild)
    const parentRunId = await runner.start('parent-task', root, { resolvedGraph: resolved(root, child) })
    await vi.waitFor(async () => expect(await store.db.select().from(schema.workflowDispatches)).toHaveLength(1))

    const cancelling = runner.cancelRun(parentRunId)
    releaseCreation()
    await cancelling

    expect((await runner.run(parentRunId))?.status).toBe('cancelled')
    const [dispatch] = await store.db.select().from(schema.workflowDispatches)
    expect(dispatch.state).toBe('terminal')
    expect(taskIds).toContain(dispatch.taskId)
    expect(cancelledTasks).not.toContain(dispatch.taskId)
    expect(await store.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.parentRunId, parentRunId))).toEqual([])
  })

  it('cancels a child agent session before settling the parent run', async () => {
    const cancelledSessions: { taskId: string; sessionId: string }[] = []
    const child: WorkflowDef = { name: 'Child', inputs: [{ name: 'ticket', required: true }], steps: [{ name: 'work' }] }
    const root = rootDefinition(false)
    const { runner } = makeRunner({
      cancelAgentSession: async (taskId, sessionId) => void cancelledSessions.push({ taskId, sessionId }),
      runStep: async (_taskId, def, opts) => {
        if (def.name === 'source') return result({ ticket: 'ABC-7' })
        opts.onEvent?.({ type: 'managed-agent', sessionId: 'child-session', sequence: 1, event: {} })
        return new Promise((resolve) => opts.signal?.addEventListener('abort', () => resolve({
          ...result(),
          status: 'cancelled' as const,
          agentSessionId: 'child-session',
        }), { once: true }))
      },
    })
    const parentRunId = await runner.start('parent-task', root, { resolvedGraph: resolved(root, child) })
    const childRow = await childRun(parentRunId)
    await vi.waitFor(async () => expect((await runner.steps(childRow.id))[0]?.agentSessionId).toBe('child-session'))

    await runner.cancelRun(parentRunId)

    expect(cancelledSessions).toContainEqual({ taskId: childRow.taskId, sessionId: 'child-session' })
    expect((await runner.run(childRow.id))?.status).toBe('cancelled')
    expect((await runner.run(parentRunId))?.status).toBe('cancelled')
  })

  it('cancels an admitted child before a parallel failure settles the parent', async () => {
    let fail = () => {}
    const failure = new Promise<void>((resolve) => { fail = resolve })
    const child: WorkflowDef = { name: 'Gated child', steps: [{ name: 'approve', kind: 'gate-human' }] }
    const root: WorkflowDef = {
      name: 'Parallel failure',
      steps: [
        {
          name: 'dispatch',
          kind: 'workflow',
          after: [],
          childWorkflow: { ref: { source: 'database', id: 'child-def' } },
        },
        { name: 'fail', after: [], prompt: 'Fail.' },
      ],
    }
    const { runner } = makeRunner({
      runStep: async () => {
        await failure
        return { ...result(), status: 'error' as const, exitCode: 1, stderrTail: 'parallel failure' }
      },
    })
    const parentRunId = await runner.start('parent-task', root, { resolvedGraph: resolved(root, child) })
    const childRow = await childRun(parentRunId)
    await waitForRun(runner, childRow.id, ['gated'])

    fail()

    expect((await waitForRun(runner, parentRunId, ['failed'])).error).toContain('parallel failure')
    expect((await runner.run(childRow.id))?.status).toBe('cancelled')
    expect(cancelledTasks).not.toContain(childRow.taskId)
    const [dispatch] = await store.db.select().from(schema.workflowDispatches)
      .where(eq(schema.workflowDispatches.runId, childRow.id))
    expect(dispatch?.state).toBe('terminal')
  })

  it('cancels a parallel sibling when the child fails and keeps the child task', async () => {
    let failChild = () => {}
    const childFailure = new Promise<void>((resolve) => { failChild = resolve })
    let siblingStarted = () => {}
    const siblingStart = new Promise<void>((resolve) => { siblingStarted = resolve })
    const siblingAborted = vi.fn()
    const child: WorkflowDef = { name: 'Failing child', steps: [{ name: 'child-work', prompt: 'Fail.' }] }
    const root: WorkflowDef = {
      name: 'Child failure',
      steps: [
        {
          name: 'dispatch',
          kind: 'workflow',
          after: [],
          childWorkflow: { ref: { source: 'database', id: 'child-def' } },
        },
        { name: 'sibling', after: [], prompt: 'Wait.' },
      ],
    }
    const { runner } = makeRunner({
      runStep: async (_taskId, def, opts) => {
        if (def.name === 'child-work') {
          await childFailure
          return { ...result(), status: 'error' as const, exitCode: 1, stderrTail: 'child failure' }
        }
        siblingStarted()
        return new Promise((resolve) => opts.signal?.addEventListener('abort', () => {
          siblingAborted()
          resolve({ ...result(), status: 'cancelled' as const })
        }, { once: true }))
      },
    })
    const parentRunId = await runner.start('parent-task', root, { resolvedGraph: resolved(root, child) })
    const childRow = await childRun(parentRunId)
    await siblingStart
    failChild()

    expect((await waitForRun(runner, parentRunId, ['failed'])).error).toContain('child failure')
    expect(siblingAborted).toHaveBeenCalledOnce()
    expect((await runner.steps(parentRunId)).find((step) => step.name === 'sibling')?.status).toBe('cancelled')
    expect(cancelledTasks).not.toContain(childRow.taskId)
  })

  it('waits for a child while all four agent slots are occupied', async () => {
    const blockers = new Set(['block-1', 'block-2', 'block-3', 'block-4'])
    const child: WorkflowDef = { name: 'Gated child', steps: [{ name: 'approve', kind: 'gate-human' }] }
    const root: WorkflowDef = {
      name: 'Parallel parent',
      steps: [
        ...[...blockers].map((name) => ({ name, after: [] as string[], prompt: 'Wait.' })),
        {
          name: 'dispatch',
          kind: 'workflow',
          after: [],
          childWorkflow: { ref: { source: 'database', id: 'child-def' } },
        },
      ],
    }
    const { runner } = makeRunner({
      runStep: async (_taskId, def, opts) => new Promise((resolve) => {
        expect(blockers).toContain(def.name)
        opts.signal?.addEventListener('abort', () => resolve({ ...result(), status: 'cancelled' as const }), { once: true })
      }),
    })
    const parentRunId = await runner.start('parent-task', root, { resolvedGraph: resolved(root, child) })

    const childRow = await childRun(parentRunId)
    expect(childRow.status).toBe('gated')
    expect((await runner.run(parentRunId))?.status).toBe('gated')
    await runner.cancelRun(parentRunId)
  })

  it('restores an expired absolute deadline as a tree safety rail after restart', async () => {
    const definition: WorkflowDef = { name: 'Expired root', steps: [{ name: 'approve', kind: 'gate-human' }] }
    const expiredAt = Date.now() - 1
    await store.db.insert(schema.workflowRuns).values({
      id: 'expired-root',
      taskId: 'parent-task',
      name: definition.name,
      status: 'gated',
      posture: 'gated',
      trigger: 'manual',
      defJson: JSON.stringify(definition),
      rootRunId: 'expired-root',
      depth: 0,
      effectiveBudgetJson: JSON.stringify({ maxWallTimeMs: 10 }),
      deadlineAt: expiredAt,
      createdAt: expiredAt - 10,
      updatedAt: expiredAt - 10,
    })
    await store.db.insert(schema.workflowSteps).values({
      id: 'expired-gate',
      runId: 'expired-root',
      idx: 0,
      name: 'approve',
      kind: 'gate-human',
      mode: 'headless',
      status: 'waiting-gate',
      createdAt: expiredAt - 10,
      updatedAt: expiredAt - 10,
    })
    const { runner } = makeRunner()

    await runner.reconcile()

    expect(await runner.run('expired-root')).toMatchObject({
      status: 'safety-rail',
      error: 'Safety rail: workflow deadline exhausted before restart recovery.',
    })
    expect((await runner.steps('expired-root'))[0]).toMatchObject({
      status: 'cancelled',
      error: 'Safety rail: workflow deadline exhausted before restart recovery.',
    })
  })

  it('stops a gated tree when a concurrent turn reports exhausted usage', async () => {
    const { runner } = makeRunner({
      runStep: async () => ({
        ...result(),
        capture: { ...result().capture, costUsd: 2 },
      }),
    })
    const runId = await runner.start('parent-task', {
      name: 'Gated budget',
      budget: { maxCostUsd: 1 },
      steps: [
        { name: 'approval', kind: 'gate-human', after: [] },
        { name: 'spender', after: [] },
      ],
    })

    expect((await waitForRun(runner, runId, ['safety-rail'])).error).toContain('cost budget exceeded')
    expect((await runner.steps(runId)).find((step) => step.name === 'approval')).toMatchObject({
      status: 'cancelled',
      error: expect.stringContaining('cost budget exceeded'),
    })
  })

  it('cancels an active descendant when the ancestor deadline expires', async () => {
    const root: WorkflowDef = {
      name: 'Deadline parent',
      budget: { maxWallTimeMs: 100 },
      steps: [{
        name: 'dispatch',
        kind: 'workflow',
        childWorkflow: { ref: { source: 'database', id: 'child-def' } },
      }],
    }
    const child: WorkflowDef = { name: 'Slow child', steps: [{ name: 'work' }] }
    const { runner } = makeRunner({
      runStep: async (_taskId, _def, opts) => new Promise((resolve) => {
        opts.signal?.addEventListener('abort', () => resolve({
          ...result(),
          status: 'cancelled' as const,
        }), { once: true })
      }),
    })
    const rootRunId = await runner.start('parent-task', root, { resolvedGraph: resolved(root, child) })
    const childRow = await childRun(rootRunId)

    expect((await waitForRun(runner, rootRunId, ['safety-rail'])).error).toMatch(/deadline exhausted|Wall-time budget exhausted/)
    expect(['cancelled', 'safety-rail']).toContain((await runner.run(childRow.id))?.status)
    expect(cancelledTasks).not.toContain(childRow.taskId)
  })

  it('honors an explicit single-child dispatch release gate', async () => {
    const child: WorkflowDef = { name: 'Child', inputs: [{ name: 'ticket', required: true }], steps: [{ name: 'work' }] }
    const root = rootDefinition(false)
    const { runner } = makeRunner({ runtimeWorkflowDispatchEnabled: false })

    await expect(runner.start('parent-task', root, { resolvedGraph: resolved(root, child) }))
      .rejects.toThrow('runtime workflow dispatch, which is not available in this build')
    expect(await store.db.select().from(schema.workflowRuns)).toEqual([])
  })
})
