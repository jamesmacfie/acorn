import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { workflowAgentLaunches, workflowRuns } from '../../node/schema'
import { createPublishedDef, publishFixtureDef } from '../../testkit/publishedDefinition'
import { getDef, updateDef } from '../definitions/store'
import { workflowRunById } from '../runs/read/readModel'
import type { WorkflowDef } from '../../shared/workflowContracts'
import {
  bootWorkflowTools,
  finishedStep,
  managed,
  workflowDef,
  type WorkflowToolHarness,
} from './test/helpers/toolHarness'

let harness: WorkflowToolHarness

beforeEach(async () => {
  harness = await bootWorkflowTools()
  harness.execute.mockResolvedValue(finishedStep({ summary: 'Done' }))
})
afterEach(() => harness.cleanup())

// One agent step that reads a caller input and declares an output.
const ticketFlow = (): WorkflowDef => ({
  ...workflowDef('Investigate', [
    {
      id: 'plan',
      name: 'Plan',
      prompt: 'Investigate ${inputs.ticket} in ${inputs.area}.',
      schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
    },
  ]),
  inputs: [
    { name: 'ticket', schema: { type: 'string' }, required: true },
    { name: 'area', schema: { type: 'string' }, required: true },
  ],
  outputs: [
    {
      name: 'summary',
      schema: { type: 'string' },
      binding: { address: { from: 'step', stepId: 'plan', pointer: '/summary' } },
    },
  ],
})

async function approved(
  def: WorkflowDef = ticketFlow(),
  overrides: Partial<{ callerInputs: string[]; fixedInputs: Record<string, string>; startsPerSession: number }> = {},
) {
  const row = await createPublishedDef(harness.store, { workspaceId: 'workspace', projectId: 'project', def })
  const definitionKey = `db:${row.id}`
  const review = await harness.invocation().review('project', definitionKey)
  const policy = await harness.invocation().approve({
    projectId: 'project',
    definitionKey,
    graphDigest: review.graphDigest,
    callerInputs: overrides.callerInputs ?? ['ticket'],
    fixedInputs: overrides.fixedInputs ?? { area: 'billing' },
    limits: { maxTurns: 5, maxWallTimeMs: 600_000 },
    startsPerSession: overrides.startsPerSession ?? 5,
  })
  const listed = (await harness.call('workflows_list', { search: def.name }, { sessionId: 'session-a' })).workflows[0]
  return { row, review, policy, ref: { source: 'database' as const, id: row.id }, digest: listed.digest as string }
}

const runCount = () => harness.store.select().from(workflowRuns).all().length
const runStatus = (id: string) =>
  harness.store.select({ status: workflowRuns.status }).from(workflowRuns).where(eq(workflowRuns.id, id)).get()?.status

describe('agent invocation review', () => {
  it('shows the owner the graph, the harness, and which fields an input reaches', async () => {
    const { review, policy } = await approved()
    expect(review).toMatchObject({
      workflowName: 'Investigate',
      posture: 'gated',
      changed: false,
      nodes: [{ path: ['$'], steps: [{ id: 'plan', kind: 'agent' }] }],
      inputUses: [{ step: 'plan', field: 'prompt', inputs: ['ticket', 'area'] }],
      defaults: { startsPerSession: 5 },
    })
    expect(policy).toMatchObject({
      state: 'active',
      callerInputs: ['ticket'],
      fixedInputs: { area: 'billing' },
      graphDigest: review.graphDigest,
    })
  })

  it('refuses an approval for a graph that changed during review, and a limit that is not finite', async () => {
    const row = await createPublishedDef(harness.store, {
      workspaceId: 'workspace',
      projectId: 'project',
      def: ticketFlow(),
    })
    const approval = {
      projectId: 'project',
      definitionKey: `db:${row.id}`,
      callerInputs: [],
      fixedInputs: {},
      limits: { maxTurns: 5, maxWallTimeMs: 600_000 },
      startsPerSession: 5,
    }
    await expect(harness.invocation().approve({ ...approval, graphDigest: 'stale' })).rejects.toThrow(
      /changed while you were reviewing/,
    )
    const { graphDigest } = await harness.invocation().review('project', `db:${row.id}`)
    await expect(harness.invocation().approve({ ...approval, graphDigest, callerInputs: ['nope'] })).rejects.toThrow(
      /no input 'nope'/,
    )
  })
})

describe('workflow_run', () => {
  it('admits at once, waits for the calling turn, then runs with the owner limits', async () => {
    const { ref, digest } = await approved()
    harness.startTurn('session-a', 'turn-1')
    const admitted = await harness.call(
      'workflow_run',
      { ref, digest, inputs: { ticket: 'BUG-7' } },
      managed('session-a', 'call-1'),
    )
    expect(admitted).toMatchObject({
      status: 'awaiting-caller',
      allowance: { used: 1, limit: 5 },
      effective: { budget: { maxTurns: 5, maxWallTimeMs: 600_000 } },
      target: { kind: 'workflow-run', resourceId: admitted.runId, taskId: 'task' },
    })
    expect(runCount()).toBe(0)
    expect(
      await harness.call('workflow_read', { runId: admitted.runId }, managed('session-a', 'read-1')),
    ).toMatchObject({ status: 'awaiting-caller' })

    harness.execute.mockResolvedValueOnce(finishedStep({ summary: 'Found it' }))
    harness.settleTurn('session-a', 'turn-1', 'completed')
    await vi.waitFor(() => expect(runStatus(admitted.runId)).toBe('done'))
    expect(harness.execute).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Investigate BUG-7 in billing.' }))
    const read = await harness.call('workflow_read', { runId: admitted.runId }, managed('session-a', 'read-2'))
    expect(read).toMatchObject({
      status: 'done',
      outputs: { summary: 'Found it' },
      launch: { state: 'started' },
      steps: [{ id: 'plan', status: 'done' }],
    })
    // The run pane names the agent and the limits the approval set.
    expect(await workflowRunById(harness.store, admitted.runId)).toMatchObject({
      trigger: 'agent-tool',
      launchedBy: { sessionId: 'session-a', title: 'Chat session-a', limits: { maxTurns: 5, maxWallTimeMs: 600_000 } },
    })
  })

  it('replays one call into one run, and refuses the same call ID with other inputs', async () => {
    const { ref, digest } = await approved()
    const first = await harness.call(
      'workflow_run',
      { ref, digest, inputs: { ticket: 'A' } },
      managed('session-a', 'call-1'),
    )
    await vi.waitFor(() => expect(runStatus(first.runId)).toBe('done'))
    expect(
      (await harness.call('workflow_run', { ref, digest, inputs: { ticket: 'A' } }, managed('session-a', 'call-1')))
        .runId,
    ).toBe(first.runId)
    expect(runCount()).toBe(1)
    await expect(
      harness.call('workflow_run', { ref, digest, inputs: { ticket: 'B' } }, managed('session-a', 'call-1')),
    ).rejects.toMatchObject({ kind: 'conflict' })
  })

  it('needs an owner approval for this exact graph, and inputs the owner allowed', async () => {
    const unapproved = await createPublishedDef(harness.store, {
      workspaceId: 'workspace',
      projectId: 'project',
      def: workflowDef('Unapproved'),
    })
    const listed = (await harness.call('workflows_list', { search: 'Unapproved' }, { sessionId: 'session-a' }))
      .workflows[0]
    expect(listed.invocation).toMatchObject({ allowed: false })
    await expect(
      harness.call(
        'workflow_run',
        { ref: { source: 'database', id: unapproved.id }, digest: listed.digest },
        managed('session-a', 'call-1'),
      ),
    ).rejects.toMatchObject({ kind: 'needs-trust' })

    const { row, ref, digest } = await approved()
    await expect(
      harness.call('workflow_run', { ref, digest: 'old', inputs: { ticket: 'A' } }, managed('session-a', 'call-2')),
    ).rejects.toMatchObject({ kind: 'conflict' })
    await expect(
      harness.call(
        'workflow_run',
        { ref, digest, inputs: { ticket: 'A', area: 'infra' } },
        managed('session-a', 'call-3'),
      ),
    ).rejects.toMatchObject({ kind: 'bad_request', message: expect.stringContaining("'area'") })

    // The owner republishes a changed step. The agent can read the new digest, but the approval no
    // longer covers the graph.
    const current = (await getDef(harness.store, row.id))!
    await updateDef(
      harness.store,
      row.id,
      {
        ...current.def,
        steps: [{ ...current.def.steps[0]!, prompt: 'Something else ${inputs.ticket} ${inputs.area}' }],
      },
      current.revision,
    )
    await publishFixtureDef(harness.store, row.id)
    const changed = (await harness.call('workflows_list', { search: 'Investigate' }, { sessionId: 'session-a' }))
      .workflows[0]
    expect(changed.invocation).toMatchObject({ allowed: false, reason: expect.stringContaining('changed') })
    await expect(
      harness.call(
        'workflow_run',
        { ref, digest: changed.digest, inputs: { ticket: 'A' } },
        managed('session-a', 'call-4'),
      ),
    ).rejects.toMatchObject({ kind: 'needs-trust' })
    expect(runCount()).toBe(0)
  })

  it('spends the session allowance once per launch, across a replacement grant', async () => {
    const { ref, digest, review } = await approved(ticketFlow(), { startsPerSession: 2 })
    for (const callId of ['call-1', 'call-2']) {
      const run = await harness.call(
        'workflow_run',
        { ref, digest, inputs: { ticket: callId } },
        managed('session-a', callId),
      )
      await vi.waitFor(() => expect(runStatus(run.runId)).toBe('done'))
    }
    await harness.call('workflow_run', { ref, digest, inputs: { ticket: 'call-1' } }, managed('session-a', 'call-1'))
    await expect(
      harness.call('workflow_run', { ref, digest, inputs: { ticket: 'x' } }, managed('session-a', 'call-3')),
    ).rejects.toMatchObject({ kind: 'conflict', message: expect.stringContaining('all 2 starts') })

    await harness.invocation().revoke('project', `db:${ref.id}`)
    await harness.invocation().approve({
      projectId: 'project',
      definitionKey: `db:${ref.id}`,
      graphDigest: review.graphDigest,
      callerInputs: ['ticket'],
      fixedInputs: { area: 'billing' },
      limits: { maxTurns: 5, maxWallTimeMs: 600_000 },
      startsPerSession: 2,
    })
    await expect(
      harness.call('workflow_run', { ref, digest, inputs: { ticket: 'x' } }, managed('session-a', 'call-4')),
    ).rejects.toMatchObject({ kind: 'conflict' })
    // Another session has its own allowance.
    expect(
      (await harness.call('workflow_run', { ref, digest, inputs: { ticket: 'x' } }, managed('session-b', 'call-1')))
        .runId,
    ).toBeDefined()
  })

  it('allows one active agent-started run per checkout', async () => {
    const { ref, digest } = await approved()
    harness.execute.mockImplementationOnce(
      (request) =>
        new Promise((resolve) => {
          request.signal?.addEventListener('abort', () => resolve({ ...finishedStep(), status: 'cancelled' }), {
            once: true,
          })
        }),
    )
    const first = await harness.call(
      'workflow_run',
      { ref, digest, inputs: { ticket: 'A' } },
      managed('session-a', 'call-1'),
    )
    await vi.waitFor(() => expect(harness.execute).toHaveBeenCalledTimes(1))
    await expect(
      harness.call('workflow_run', { ref, digest, inputs: { ticket: 'B' } }, managed('session-b', 'call-1')),
    ).rejects.toMatchObject({ kind: 'conflict', message: expect.stringContaining(first.runId) })
    await harness.call('workflow_cancel', { runId: first.runId }, managed('session-a', 'cancel-1'))
    await vi.waitFor(() => expect(runStatus(first.runId)).toBe('cancelled'))
  })

  it('never starts for a workflow-owned, delegated, or terminal session', async () => {
    const { ref, digest } = await approved()
    harness.sessions.set('step-session', { workflowOwned: true, workflowRunId: 'run-x' })
    harness.sessions.set('spawned-child', { delegated: true })
    await expect(
      harness.call('workflow_run', { ref, digest }, managed('step-session', 'call-1')),
    ).rejects.toMatchObject({ kind: 'not_found' })
    // A spawned child would bring a fresh start allowance with it.
    await expect(
      harness.call('workflow_run', { ref, digest, inputs: { ticket: 'A' } }, managed('spawned-child', 'call-1')),
    ).rejects.toMatchObject({ kind: 'not_found' })
    await expect(
      harness.call('workflow_run', { ref, digest }, managed('terminal-session', 'call-1')),
    ).rejects.toMatchObject({ kind: 'not_found' })
    expect(harness.store.select().from(workflowAgentLaunches).all()).toHaveLength(0)
  })
})

describe('handoff, stop, and restart', () => {
  it('never starts a waiting launch after the owner revokes the approval', async () => {
    const { ref, digest } = await approved()
    harness.startTurn('session-a', 'turn-1')
    const admitted = await harness.call(
      'workflow_run',
      { ref, digest, inputs: { ticket: 'A' } },
      managed('session-a', 'call-1'),
    )
    await harness.invocation().revoke('project', `db:${ref.id}`)
    harness.settleTurn('session-a', 'turn-1', 'completed')
    await vi.waitFor(async () =>
      expect(
        await harness.call('workflow_read', { runId: admitted.runId }, managed('session-a', 'read')),
      ).toMatchObject({ status: 'not-started', error: expect.stringContaining('withdrew') }),
    )
    expect(runCount()).toBe(0)
  })

  it('cancels the launch when the owner stops the turn that made it', async () => {
    const { ref, digest } = await approved()
    harness.startTurn('session-a', 'turn-1')
    const admitted = await harness.call(
      'workflow_run',
      { ref, digest, inputs: { ticket: 'A' } },
      managed('session-a', 'call-1'),
    )
    harness.settleTurn('session-a', 'turn-1', 'cancelled')
    await vi.waitFor(async () =>
      expect(
        await harness.call('workflow_read', { runId: admitted.runId }, managed('session-a', 'read')),
      ).toMatchObject({ status: 'cancelled' }),
    )
    expect(runCount()).toBe(0)
  })

  it('stops a running launched run when the owner stops its session, but not when a turn ends normally', async () => {
    const { ref, digest } = await approved()
    harness.execute.mockImplementationOnce(
      (request) =>
        new Promise((resolve) => {
          request.signal?.addEventListener('abort', () => resolve({ ...finishedStep(), status: 'cancelled' }), {
            once: true,
          })
        }),
    )
    const run = await harness.call(
      'workflow_run',
      { ref, digest, inputs: { ticket: 'A' } },
      managed('session-a', 'call-1'),
    )
    await vi.waitFor(() => expect(harness.execute).toHaveBeenCalledTimes(1))
    harness.startTurn('session-a', 'turn-2')
    harness.settleTurn('session-a', 'turn-2', 'completed')
    expect(runStatus(run.runId)).toBe('running')
    harness.startTurn('session-a', 'turn-3')
    harness.settleTurn('session-a', 'turn-3', 'cancelled')
    await vi.waitFor(() => expect(runStatus(run.runId)).toBe('cancelled'))
  })

  it('starts exactly one run after a restart between admission and dispatch', async () => {
    const { ref, digest } = await approved()
    harness.startTurn('session-a', 'turn-1')
    const admitted = await harness.call(
      'workflow_run',
      { ref, digest, inputs: { ticket: 'A' } },
      managed('session-a', 'call-1'),
    )
    const root = harness.root
    await harness.stop()

    // The caller's turn finished while the Node was down. No event arrives for it after the restart.
    harness = await bootWorkflowTools(root)
    harness.execute.mockResolvedValue(finishedStep({ summary: 'Done' }))
    harness.startTurn('session-a', 'turn-1')
    harness.settleTurn('session-a', 'turn-1', 'completed')
    await vi.waitFor(() => expect(runStatus(admitted.runId)).toBe('done'))

    // A crash after the run row but before the receipt said so.
    harness.store.update(workflowAgentLaunches).set({ state: 'awaiting-caller' }).run()
    await harness.stop()
    harness = await bootWorkflowTools(root)
    await vi.waitFor(() => expect(harness.store.select().from(workflowAgentLaunches).get()?.state).toBe('started'))
    expect(runCount()).toBe(1)
  })
})

describe('reading, waiting, and cancelling', () => {
  it("keeps other sessions' runs and unknown IDs out of reach", async () => {
    const { ref, digest } = await approved()
    const run = await harness.call(
      'workflow_run',
      { ref, digest, inputs: { ticket: 'A' } },
      managed('session-a', 'call-1'),
    )
    for (const runId of [run.runId, 'missing']) {
      await expect(harness.call('workflow_read', { runId }, managed('session-b', 'read'))).rejects.toMatchObject({
        kind: 'not_found',
        message: 'No run you may read has that ID.',
      })
      await expect(harness.call('workflow_cancel', { runId }, managed('session-b', 'cancel'))).rejects.toMatchObject({
        kind: 'not_found',
      })
    }
  })

  it('lets a workflow step session read its own workflow but not start or cancel it', async () => {
    const { ref, digest } = await approved()
    const run = await harness.call(
      'workflow_run',
      { ref, digest, inputs: { ticket: 'A' } },
      managed('session-a', 'call-1'),
    )
    harness.sessions.set('step-session', { workflowOwned: true, workflowRunId: run.runId })
    await vi.waitFor(() => expect(runStatus(run.runId)).toBe('done'))
    expect(await harness.call('workflow_read', { runId: run.runId }, managed('step-session', 'read'))).toMatchObject({
      status: 'done',
    })
    await expect(
      harness.call('workflow_cancel', { runId: run.runId }, managed('step-session', 'cancel')),
    ).rejects.toMatchObject({ kind: 'not_found' })
  })

  it('wakes a wait promptly at a gate and leaves the run alive on timeout', async () => {
    const def: WorkflowDef = { ...workflowDef('Gated', [{ id: 'approve', name: 'Approve', kind: 'gate-human' }]) }
    const { ref, digest } = await approved(def, { callerInputs: [], fixedInputs: {} })
    const run = await harness.call('workflow_run', { ref, digest }, managed('session-a', 'call-1'))
    const waited = await harness.call(
      'workflow_wait',
      { runId: run.runId, timeoutMs: 5_000 },
      managed('session-a', 'wait-1'),
    )
    expect(waited).toMatchObject({ reason: 'attention', attention: [{ kind: 'gate', step: 'Approve' }] })
    const quiet = await harness.call(
      'workflow_wait',
      { runId: run.runId, after: waited.observation, timeoutMs: 600 },
      managed('session-a', 'wait-2'),
    )
    expect(quiet.reason).toBe('timeout')
    expect(runStatus(run.runId)).toBe('gated')
  })
})
