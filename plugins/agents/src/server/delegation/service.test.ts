import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { ToolContext } from '@acorn/plugin-api/node'
import type { AgentProviderDescriptor } from '@acorn/protocol/managedAgents.ts'
import type { TerminalSession } from '@acorn/protocol/terminal.ts'
import { AgentStore } from '../sessions/store'
import type { ManagedAgentRuntime } from '../sessions/runtime'
import { AgentDelegationStore } from './store'
import { AgentDelegationService } from './service'

const PROVIDER: AgentProviderDescriptor = {
  id: 'codex',
  profileId: 'codex',
  label: 'Codex',
  driverKind: 'codex-app-server',
  driverVersion: 'test',
  installed: true,
  authenticated: true,
  statusAuthority: 'protocol',
  capabilities: [],
  configOptions: [],
  commands: [],
  skills: [],
  diagnostics: [],
}

const terminal = (id: string, taskId: string): TerminalSession => ({
  id,
  taskId,
  title: 'Codex terminal',
  kind: 'agent',
  profileId: 'codex',
  backend: 'node-pty',
  status: 'running',
  idle: false,
  agentState: 'working',
  isWorktree: false,
  cwd: '/tmp/task',
  command: 'codex',
  cols: 80,
  rows: 24,
  createdAt: 1,
  exitCode: null,
})

describe('agent delegation service', () => {
  let ctx: TestNodeContext
  let sessions: AgentStore
  let service: AgentDelegationService
  let terminals: TerminalSession[]
  let runtime: ManagedAgentRuntime
  let childTasks: Map<string, { parentTaskId: string; title: string; branch: string }>
  let createChildTask: ReturnType<typeof vi.fn<(
    parentTaskId: string,
    seed: { title: string; branch: string },
    intendedChildId?: string,
  ) => Promise<string>>>

  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    const db = ctx.storage.open()
    sessions = new AgentStore(db, ctx.core)
    terminals = []
    childTasks = new Map()
    createChildTask = vi.fn(async (
      parentTaskId: string,
      seed: { title: string; branch: string },
      intendedChildId?: string,
    ) => {
      if (!intendedChildId) throw new Error('The test task service requires an intended child id.')
      const existing = childTasks.get(intendedChildId)
      if (existing && (existing.parentTaskId !== parentTaskId || existing.title !== seed.title || existing.branch !== seed.branch)) {
        throw new Error('conflicting intended child task')
      }
      childTasks.set(intendedChildId, { parentTaskId, ...seed })
      return intendedChildId
    })
    runtime = {
      store: sessions,
      providers: async () => [PROVIDER],
      acceptSession: vi.fn(async (input: Parameters<ManagedAgentRuntime['acceptSession']>[0]) => sessions.createSession(input, PROVIDER)),
      enqueueTurn: vi.fn(async (sessionId: string, input: Parameters<ManagedAgentRuntime['enqueueTurn']>[1]) =>
        (await sessions.enqueueTurn(sessionId, input)).turn),
      applyRequestedConfig: vi.fn(async () => undefined),
      wait: vi.fn((sessionId: string, afterSeq: number) => sessions.snapshot(sessionId, afterSeq)),
      cancelTurn: vi.fn(async (sessionId: string, turnId?: string) => {
        const target = turnId ? await sessions.turn(turnId) : await sessions.activeTurn(sessionId)
        if (target?.sessionId === sessionId) await sessions.cancelTurn(target.id)
      }),
    } as unknown as ManagedAgentRuntime
    service = new AgentDelegationService(
      runtime,
      new AgentDelegationStore(db),
      async () => terminals,
      { createChild: createChildTask },
    )
  })
  afterEach(() => ctx.cleanup())

  const managedCaller = async (
    taskId = '11111111-1111-4111-8111-111111111111',
    config: Record<string, unknown> = {},
  ) => sessions.createSession({
    taskId,
    providerId: 'codex',
    profileId: 'codex',
    title: 'Parent',
    kind: 'interactive',
    config,
  }, PROVIDER)

  const context = (taskId: string, sessionId: string, callId = 'call-1'): ToolContext => ({
    taskId,
    sessionId,
    callId,
    userLogin: 'owner',
    toolCeiling: { allow: ['agent_spawn', 'agent_read', 'task_context'], maxRisk: 'execute' },
  })

  const spawnChild = async (callId = 'spawn-child') => {
    const parent = await managedCaller()
    const child = await service.spawn(
      { title: 'Child', prompt: 'First turn.', isolation: 'shared' },
      context(parent.taskId, parent.id, callId),
    )
    return { parent, child }
  }

  const provisioningPlan = (overrides: Record<string, unknown> = {}) => ({
    title: 'Worktree child',
    prompt: 'Inspect the branch.',
    branch: 'Worktree child',
    providerId: 'codex',
    profileId: 'codex',
    parentSessionId: null,
    parentTurnId: null,
    toolCeiling: { allow: ['agent_read'], maxRisk: 'execute' as const },
    ...overrides,
  })
  const reconcileAfterRestart = () => new AgentDelegationService(
    runtime,
    service.store,
    async () => terminals,
    { createChild: createChildTask },
  ).reconcile()

  it('creates one durable child and turn for a replayed managed caller call', async () => {
    const parent = await managedCaller()
    const { turn: parentTurn } = await sessions.enqueueTurn(parent.id, {
      input: [{ type: 'text', text: 'delegate' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: 'parent-turn',
    })
    await sessions.startTurn(parentTurn.id)
    const caller = context(parent.taskId, parent.id)
    const first = await service.spawn({
      title: 'Inspect tests',
      prompt: 'Read the tests and report.',
      isolation: 'shared',
      toolCeiling: { allow: ['agent_read', 'unknown'], maxRisk: 'write' },
    }, caller)
    const replay = await service.spawn({ title: 'Ignored replay body', prompt: 'ignored', isolation: 'shared' }, caller)

    expect(replay).toEqual(first)
    const child = await sessions.requireSession(first.sessionId!)
    expect(child).toMatchObject({
      kind: 'delegated',
      parentSessionId: parent.id,
      parentTurnId: parentTurn.id,
      config: {
        toolCeiling: { allow: ['agent_read'], maxRisk: 'write' },
      },
    })
    expect((await sessions.turn(first.turnId!))?.source).toBe('delegation')
  })

  it('does not accept a spawn until restart reconciliation has finished', async () => {
    const parent = await managedCaller()
    let release!: () => void
    const reconciled = new Promise<void>((resolve) => (release = resolve))
    const gated = new AgentDelegationService(
      runtime,
      service.store,
      async () => terminals,
      { createChild: createChildTask },
      reconciled,
    )
    let settled = false
    const spawning = gated.spawn(
      { title: 'After recovery', prompt: 'Report.', isolation: 'shared' },
      context(parent.taskId, parent.id, 'after-recovery'),
    ).finally(() => (settled = true))

    await Promise.resolve()
    expect(settled).toBe(false)
    expect((await sessions.listSessions({ taskId: parent.taskId })).sessions).toEqual([parent])

    release()
    await expect(spawning).resolves.toMatchObject({ provisioningState: 'provisioned' })
  })

  it('accepts a signed terminal caller shape and inherits its managed profile', async () => {
    const taskId = '22222222-2222-4222-8222-222222222222'
    terminals = [terminal('terminal-1', taskId)]
    const result = await service.spawn({
      title: 'Terminal child',
      prompt: 'Report.',
      isolation: 'shared',
    }, context(taskId, 'terminal-1'))
    const child = await sessions.requireSession(result.sessionId!)
    expect(child).toMatchObject({ profileId: 'codex', parentSessionId: null, parentTurnId: null })
  })

  it('provisions an owned worktree child task, session, and initial turn exactly once', async () => {
    const parent = await managedCaller()
    const caller = context(parent.taskId, parent.id, 'worktree-spawn')
    const first = await service.spawn({
      title: 'Inspect tests',
      prompt: 'Inspect the branch.',
      isolation: 'worktree',
    }, caller)
    const replay = await service.spawn({
      title: 'Ignored retry',
      prompt: 'Ignored retry.',
      isolation: 'worktree',
    }, caller)

    expect(replay).toEqual(first)
    expect(first).toMatchObject({ provisioningState: 'provisioned', depth: 1 })
    expect(first.taskId).not.toBe(parent.taskId)
    expect(createChildTask).toHaveBeenCalledTimes(1)
    expect(createChildTask).toHaveBeenCalledWith(
      parent.taskId,
      { title: 'Inspect tests', branch: 'Inspect tests' },
      first.taskId,
    )
    expect(await sessions.requireSession(first.sessionId!)).toMatchObject({
      taskId: first.taskId,
      parentSessionId: parent.id,
      kind: 'delegated',
    })
    expect(await sessions.turn(first.turnId!)).toMatchObject({ source: 'delegation', status: 'queued' })

    await service.cancel(
      { sessionId: first.sessionId!, turnId: first.turnId! },
      context(parent.taskId, parent.id, 'cancel-worktree'),
    )
    expect(childTasks.has(first.taskId)).toBe(true)
    expect((await sessions.turn(first.turnId!))?.status).toBe('cancelled')
  })

  it('reconciles creating worktree rows from each durable provisioning boundary', async () => {
    const noTask = service.store.reserveWorktree({
      ownerTaskId: 'parent-a', ownerSessionId: 'owner-a', idempotencyKey: 'agent_spawn:no-task',
      provisioning: provisioningPlan(),
    }).spawn
    await reconcileAfterRestart()
    expect(await service.store.get(noTask.id)).toMatchObject({ provisioningState: 'provisioned' })
    expect(childTasks.has(noTask.childTaskId)).toBe(true)

    const taskOnly = service.store.reserveWorktree({
      ownerTaskId: 'parent-b', ownerSessionId: 'owner-b', idempotencyKey: 'agent_spawn:task-only',
      provisioning: provisioningPlan({ title: 'Task only', branch: 'Task only' }),
    }).spawn
    childTasks.set(taskOnly.childTaskId, { parentTaskId: 'parent-b', title: 'Task only', branch: 'Task only' })
    await reconcileAfterRestart()
    expect(await service.store.get(taskOnly.id)).toMatchObject({ provisioningState: 'provisioned' })

    const sessionOnly = service.store.reserveWorktree({
      ownerTaskId: 'parent-c', ownerSessionId: 'owner-c', idempotencyKey: 'agent_spawn:session-only',
      provisioning: provisioningPlan({ title: 'Session only', branch: 'Session only' }),
    }).spawn
    childTasks.set(sessionOnly.childTaskId, { parentTaskId: 'parent-c', title: 'Session only', branch: 'Session only' })
    const recoveredSession = await sessions.createSession({
      taskId: sessionOnly.childTaskId,
      providerId: 'codex',
      profileId: 'codex',
      title: 'Session only',
      kind: 'delegated',
      config: { delegationSpawnId: sessionOnly.id },
    }, PROVIDER)
    await reconcileAfterRestart()
    const repairedSessionOnly = await service.store.get(sessionOnly.id)
    expect(repairedSessionOnly).toMatchObject({
      provisioningState: 'provisioned',
      childSessionId: recoveredSession.id,
      childTurnId: expect.any(String),
    })
    expect((await sessions.snapshot(recoveredSession.id)).turns).toHaveLength(1)

    const turnWritten = service.store.reserveWorktree({
      ownerTaskId: 'parent-d', ownerSessionId: 'owner-d', idempotencyKey: 'agent_spawn:turn-written',
      provisioning: provisioningPlan({ title: 'Turn written', branch: 'Turn written' }),
    }).spawn
    childTasks.set(turnWritten.childTaskId, { parentTaskId: 'parent-d', title: 'Turn written', branch: 'Turn written' })
    const turnSession = await sessions.createSession({
      taskId: turnWritten.childTaskId,
      providerId: 'codex',
      profileId: 'codex',
      title: 'Turn written',
      kind: 'delegated',
      config: { delegationSpawnId: turnWritten.id },
    }, PROVIDER)
    const { turn: recoveredTurn } = await sessions.enqueueTurn(turnSession.id, {
      input: [{ type: 'text', text: 'Inspect the branch.' }],
      source: 'delegation',
      effectivePolicy: { delegationSpawnId: turnWritten.id },
      idempotencyKey: `delegation:${turnWritten.id}:turn`,
    })
    await reconcileAfterRestart()
    expect(await service.store.get(turnWritten.id)).toMatchObject({
      provisioningState: 'provisioned',
      childSessionId: turnSession.id,
      childTurnId: recoveredTurn.id,
    })
    expect((await sessions.listSessions({ taskId: turnWritten.childTaskId })).sessions).toHaveLength(1)
  })

  it('retains the child task and a bounded failed row when worktree session provisioning fails', async () => {
    const parent = await managedCaller()
    vi.mocked(runtime.acceptSession).mockRejectedValueOnce(new Error(`provider failed\n${'x'.repeat(4_000)}`))
    const failed = await service.spawn({
      title: 'Dirty worktree',
      prompt: 'Make changes.',
      isolation: 'worktree',
    }, context(parent.taskId, parent.id, 'failed-worktree'))

    expect(failed.provisioningState).toBe('failed')
    expect(failed.error?.length).toBeLessThanOrEqual(2_000)
    expect(failed.error).not.toContain('\n')
    expect(childTasks.has(failed.taskId)).toBe(true)
    expect(await service.store.get(failed.spawnId)).toMatchObject({
      provisioningState: 'failed',
      childSessionId: null,
    })
    await service.reconcile()
    expect(createChildTask).toHaveBeenCalledTimes(1)
  })

  it('retains and links a child session when initial-turn provisioning fails', async () => {
    const parent = await managedCaller()
    vi.mocked(runtime.enqueueTurn).mockRejectedValueOnce(new Error('turn hook refused the prompt'))
    const failed = await service.spawn({
      title: 'Recoverable session', prompt: 'Report.', isolation: 'worktree',
    }, context(parent.taskId, parent.id, 'failed-turn'))
    const row = await service.store.get(failed.spawnId)

    expect(row).toMatchObject({
      provisioningState: 'failed',
      childTaskId: failed.taskId,
      childSessionId: expect.any(String),
      childTurnId: null,
    })
    expect((await sessions.requireSession(row!.childSessionId!)).taskId).toBe(failed.taskId)
    expect(childTasks.has(failed.taskId)).toBe(true)
  })

  it('allows only the parent-task owner to control a worktree child session', async () => {
    const parent = await managedCaller()
    const child = await service.spawn({
      title: 'Owned worktree', prompt: 'Report.', isolation: 'worktree',
    }, context(parent.taskId, parent.id, 'owned-worktree'))

    await expect(service.read(
      { sessionId: child.sessionId!, afterSeq: 0, limit: 10 },
      context(child.taskId, parent.id, 'wrong-task'),
    )).rejects.toMatchObject({ kind: 'not_found' })
    await expect(service.read(
      { sessionId: child.sessionId!, afterSeq: 0, limit: 10 },
      context(parent.taskId, parent.id, 'right-task'),
    )).resolves.toMatchObject({ sessionId: child.sessionId })
  })

  it('projects bounded managed and terminal ownership metadata onto listed children', async () => {
    const managedParent = await managedCaller()
    const managedChild = await service.spawn({
      title: 'Managed child',
      prompt: 'Report.',
      isolation: 'shared',
    }, context(managedParent.taskId, managedParent.id, 'managed-visibility'))

    const terminalTaskId = '33333333-3333-4333-8333-333333333333'
    terminals = [terminal('terminal-private-id', terminalTaskId)]
    const terminalChild = await service.spawn({
      title: 'Terminal child',
      prompt: 'Report.',
      isolation: 'shared',
    }, context(terminalTaskId, 'terminal-private-id', 'terminal-visibility'))

    const managedPage = await service.projectSessionList(await sessions.listSessions({ taskId: managedParent.taskId }))
    expect(managedPage.delegations).toContainEqual({
      sessionId: managedChild.sessionId,
      depth: 1,
      isolation: 'shared',
      owner: { kind: 'managed', parentSessionId: managedParent.id },
    })
    const terminalPage = await service.projectSessionList(await sessions.listSessions({ taskId: terminalTaskId }))
    expect(terminalPage.delegations).toContainEqual({
      sessionId: terminalChild.sessionId,
      depth: 1,
      isolation: 'shared',
      owner: { kind: 'terminal', label: 'Codex terminal', profileId: 'codex' },
    })
    expect(JSON.stringify(terminalPage.delegations)).not.toContain('terminal-private-id')
  })

  it('projects a terminal owner from the parent task onto its worktree child task', async () => {
    const parentTaskId = '44444444-4444-4444-8444-444444444444'
    terminals = [terminal('terminal-worktree-owner', parentTaskId)]
    const child = await service.spawn({
      title: 'Worktree child', prompt: 'Report.', isolation: 'worktree',
    }, context(parentTaskId, 'terminal-worktree-owner', 'terminal-worktree'))

    const page = await service.projectSessionList(await sessions.listSessions({ taskId: child.taskId }))
    expect(page.delegations).toContainEqual({
      sessionId: child.sessionId,
      depth: 1,
      isolation: 'worktree',
      owner: { kind: 'terminal', label: 'Codex terminal', profileId: 'codex' },
    })
  })

  it('requires an explicit managed profile when a terminal profile has no managed driver', async () => {
    const taskId = '22222222-2222-4222-8222-222222222222'
    terminals = [{ ...terminal('terminal-1', taskId), kind: 'shell', profileId: 'shell', command: '$SHELL' }]
    await expect(service.spawn({
      title: 'Unsupported inherited profile',
      prompt: 'Report.',
      isolation: 'shared',
    }, context(taskId, 'terminal-1'))).rejects.toMatchObject({ kind: 'bad_request' })

    const child = await service.spawn({
      title: 'Explicit managed profile',
      prompt: 'Report.',
      profileId: 'codex',
      isolation: 'shared',
    }, context(taskId, 'terminal-1', 'call-2'))
    expect((await sessions.requireSession(child.sessionId!)).profileId).toBe('codex')
  })

  it('withholds spawning from workflow-owned callers and rejects absent call ids', async () => {
    const workflow = await managedCaller(undefined, { workflowRunId: 'run-1' })
    expect(await service.canSpawn(context(workflow.taskId, workflow.id))).toBe(false)
    await expect(service.spawn({ title: 'No', prompt: 'No', isolation: 'shared' }, context(workflow.taskId, workflow.id)))
      .rejects.toMatchObject({ kind: 'not_found' })
    const ordinary = await managedCaller()
    await expect(service.spawn(
      { title: 'No id', prompt: 'No id', isolation: 'shared' },
      { ...context(ordinary.taskId, ordinary.id), callId: undefined },
    )).rejects.toMatchObject({ kind: 'bad_request' })
  })

  it('pages and folds useful output while omitting verbose tool payloads', async () => {
    const parent = await managedCaller()
    const child = await service.spawn({ title: 'Reader', prompt: 'Report.', isolation: 'shared' }, context(parent.taskId, parent.id))
    await sessions.recordEvent(child.sessionId!, child.turnId, { type: 'assistant_message', text: 'hel', messageId: 'm1', append: true })
    await sessions.recordEvent(child.sessionId!, child.turnId, { type: 'assistant_message', text: 'lo', messageId: 'm1', append: true })
    await sessions.recordEvent(child.sessionId!, child.turnId, {
      type: 'tool',
      tool: { id: 'tool-1', title: 'Huge command', input: 'secret '.repeat(1_000), output: 'bytes '.repeat(1_000) },
    })
    await sessions.recordEvent(child.sessionId!, child.turnId, { type: 'diagnostic', level: 'warning', message: 'Check this.' })
    await sessions.recordEvent(child.sessionId!, child.turnId, { type: 'error', code: 'failed', message: 'Stopped.', retryable: false })

    const pageOne = await service.read({ sessionId: child.sessionId!, afterSeq: 0, limit: 4 }, context(parent.taskId, parent.id, 'read-1'))
    expect(pageOne).toMatchObject({
      items: [
        { type: 'assistant_message', text: 'hello', fromSeq: 1, toSeq: 2 },
        { type: 'diagnostic', message: 'Check this.', seq: 4 },
      ],
      nextCursor: 4,
      hasMore: true,
    })
    expect(JSON.stringify(pageOne)).not.toContain('secret')
    const pageTwo = await service.read({ sessionId: child.sessionId!, afterSeq: pageOne.nextCursor, limit: 4 }, context(parent.taskId, parent.id, 'read-2'))
    expect(pageTwo).toMatchObject({
      items: [{ type: 'error', code: 'failed', message: 'Stopped.', seq: 5 }],
      nextCursor: 5,
      hasMore: false,
    })
  })

  it('returns structured output only after the declared schema validates it', async () => {
    const parent = await managedCaller()
    const child = await service.spawn({
      title: 'Structured reader',
      prompt: 'Return a verdict.',
      isolation: 'shared',
      resultSchema: {
        type: 'object',
        properties: { verdict: { type: 'string', enum: ['pass', 'fail'] } },
        required: ['verdict'],
        additionalProperties: false,
      },
    }, context(parent.taskId, parent.id))
    await sessions.recordEvent(child.sessionId!, child.turnId, {
      type: 'assistant_message',
      text: '```json\n{"verdict":"pass"}\n```',
    })
    await sessions.recordEvent(child.sessionId!, child.turnId, { type: 'turn_completed', stopReason: 'end_turn' })

    const read = await service.read({ sessionId: child.sessionId!, afterSeq: 0, limit: 10 }, context(parent.taskId, parent.id, 'read'))
    expect(read.items).toContainEqual({
      type: 'structured_output',
      value: { verdict: 'pass' },
      turnId: child.turnId,
      seq: 2,
    })
  })

  it('queues an idempotent delegation turn and preserves its result across service restart', async () => {
    const { parent, child } = await spawnChild()
    await sessions.startTurn(child.turnId!)
    const caller = context(parent.taskId, parent.id, 'prompt-retry')
    const [first, duplicate] = await Promise.all([
      service.prompt({ sessionId: child.sessionId!, prompt: 'Continue.' }, caller),
      service.prompt({ sessionId: child.sessionId!, prompt: 'Duplicate transport delivery.' }, caller),
    ])
    const restarted = new AgentDelegationService(runtime, service.store, async () => terminals)
    const replay = await restarted.prompt({ sessionId: child.sessionId!, prompt: 'Changed retry body.' }, caller)

    expect(duplicate).toEqual(first)
    expect(replay).toEqual(first)
    expect(first).toMatchObject({
      sessionId: child.sessionId,
      queueState: 'queued',
      queueOrdinal: 1,
      cursor: 0,
    })
    const snapshot = await sessions.snapshot(child.sessionId!)
    expect(snapshot.turns).toHaveLength(2)
    expect(snapshot.turns[1]).toMatchObject({ id: first.turnId, source: 'delegation' })
  })

  it('does not reveal a missing or foreign named turn through cancellation', async () => {
    const { parent, child } = await spawnChild()
    const other = await managedCaller(parent.taskId)
    const { turn: foreignTurn } = await sessions.enqueueTurn(other.id, {
      input: [{ type: 'text', text: 'Foreign.' }],
      source: 'interactive',
      effectivePolicy: {},
      idempotencyKey: 'foreign-turn',
    })
    for (const turnId of [foreignTurn.id, '99999999-9999-4999-8999-999999999999']) {
      await expect(service.cancel(
        { sessionId: child.sessionId!, turnId },
        context(parent.taskId, parent.id, `cancel-${turnId}`),
      )).rejects.toMatchObject({ kind: 'not_found' })
    }
  })

  it('applies narrowed provider options only with an idle queue and records a per-turn result contract', async () => {
    const { parent, child } = await spawnChild()
    await sessions.cancelTurn(child.turnId!)
    const schema = {
      type: 'object',
      properties: { answer: { type: 'number' } },
      required: ['answer'],
      additionalProperties: false,
    }
    const result = await service.prompt({
      sessionId: child.sessionId!,
      prompt: 'Calculate.',
      resultSchema: schema,
      configOptions: { model: 'supported' },
    }, context(parent.taskId, parent.id, 'configured-prompt'))

    expect(runtime.applyRequestedConfig).toHaveBeenCalledWith(child.sessionId, { model: 'supported' })
    expect(await sessions.turn(result.turnId)).toMatchObject({
      source: 'delegation',
      effectivePolicy: { resultSchema: schema, configOptions: { model: 'supported' } },
    })
    await expect(service.prompt({
      sessionId: child.sessionId!,
      prompt: 'Do not mutate the queued turn.',
      configOptions: { model: 'other' },
    }, context(parent.taskId, parent.id, 'conflicting-config'))).rejects.toMatchObject({ kind: 'conflict' })
  })

  it('rejects invalid result schemas before accepting durable work', async () => {
    const { parent, child } = await spawnChild()
    const before = (await sessions.snapshot(child.sessionId!)).turns.length
    await expect(service.prompt({
      sessionId: child.sessionId!,
      prompt: 'Invalid contract.',
      resultSchema: { type: 'not-a-json-schema-type' },
    }, context(parent.taskId, parent.id, 'invalid-schema'))).rejects.toMatchObject({ kind: 'bad_request' })
    expect((await sessions.snapshot(child.sessionId!)).turns).toHaveLength(before)
  })

  it('returns normal timeout and attention wait results with a stable cursor', async () => {
    const { parent, child } = await spawnChild()
    const caller = context(parent.taskId, parent.id, 'wait')
    const timedOut = await service.wait({
      sessionId: child.sessionId!,
      afterSeq: 0,
      until: 'turn_completed',
      timeoutMs: 25,
    }, caller)
    expect(timedOut).toMatchObject({ matched: false, timedOut: true, lastSeq: 0 })
    expect(runtime.wait).toHaveBeenCalledWith(child.sessionId, 0, 'turn_completed', 25)

    await sessions.recordEvent(child.sessionId!, child.turnId, {
      type: 'request',
      requestId: 'permission-1',
      kind: 'permission',
      title: 'Approve command',
    })
    const attention = await service.wait({
      sessionId: child.sessionId!,
      afterSeq: 0,
      until: 'attention',
      timeoutMs: 30_000,
    }, context(parent.taskId, parent.id, 'wait-attention'))
    expect(attention).toMatchObject({
      matched: true,
      timedOut: false,
      state: 'waiting',
      attention: 'permission',
      lastSeq: 1,
    })
  })

  it('reports terminal state and conflicts when a failed child is prompted', async () => {
    const { parent, child } = await spawnChild()
    await sessions.recordEvent(child.sessionId!, child.turnId, {
      type: 'error',
      code: 'provider_failed',
      message: 'Provider stopped.',
      retryable: false,
    })
    const stopped = await service.wait({
      sessionId: child.sessionId!,
      afterSeq: 0,
      until: 'stopped',
      timeoutMs: 0,
    }, context(parent.taskId, parent.id, 'terminal-wait'))
    expect(stopped).toMatchObject({ matched: true, timedOut: false, state: 'failed', attention: 'error' })
    await expect(service.prompt(
      { sessionId: child.sessionId!, prompt: 'Retry.' },
      context(parent.taskId, parent.id, 'terminal-prompt'),
    )).rejects.toMatchObject({ kind: 'conflict' })
  })

  it('cancels a named queued turn idempotently without deleting its prior events', async () => {
    const { parent, child } = await spawnChild()
    await sessions.recordEvent(child.sessionId!, child.turnId, {
      type: 'diagnostic',
      level: 'warning',
      message: 'Keep this diagnostic.',
    })
    const caller = context(parent.taskId, parent.id, 'cancel-retry')
    const first = await service.cancel({ sessionId: child.sessionId!, turnId: child.turnId! }, caller)
    const replay = await service.cancel({ sessionId: child.sessionId! }, caller)

    expect(replay).toEqual(first)
    expect(first).toMatchObject({ sessionId: child.sessionId, cancelledTurnId: child.turnId })
    expect((await sessions.turn(child.turnId!))?.status).toBe('cancelled')
    expect((await sessions.eventsForTurn(child.turnId!)).map((record) => record.event)).toContainEqual({
      type: 'diagnostic',
      level: 'warning',
      message: 'Keep this diagnostic.',
    })
  })

  it('surfaces malformed structured output as a bounded read diagnostic', async () => {
    const parent = await managedCaller()
    const child = await service.spawn({
      title: 'Structured child',
      prompt: 'Return a verdict.',
      isolation: 'shared',
      resultSchema: {
        type: 'object',
        properties: { verdict: { type: 'string', enum: ['pass'] } },
        required: ['verdict'],
        additionalProperties: false,
      },
    }, context(parent.taskId, parent.id, 'malformed-spawn'))
    await sessions.recordEvent(child.sessionId!, child.turnId, { type: 'assistant_message', text: '{"verdict":"fail"}' })
    await sessions.recordEvent(child.sessionId!, child.turnId, { type: 'turn_completed' })

    const read = await service.read(
      { sessionId: child.sessionId!, afterSeq: 0, limit: 10 },
      context(parent.taskId, parent.id, 'malformed-read'),
    )
    expect(read.items).toContainEqual({
      type: 'diagnostic',
      level: 'warning',
      message: 'The child returned no output that matches the declared result schema.',
      turnId: child.turnId,
      seq: 2,
    })
  })

  it('hides control operations from siblings, ancestors, descendants, and other tasks', async () => {
    const root = await managedCaller()
    const sibling = await managedCaller(root.taskId)
    const child = await service.spawn({ title: 'Child', prompt: 'Report.', isolation: 'shared' }, context(root.taskId, root.id, 'owned-child'))
    const grandchild = await service.spawn({ title: 'Grandchild', prompt: 'Report.', isolation: 'shared' }, context(root.taskId, child.sessionId!, 'owned-grandchild'))
    const foreignContexts = [
      context(root.taskId, sibling.id, 'foreign-sibling'),
      context(root.taskId, root.id, 'foreign-grandchild'),
      context(root.taskId, grandchild.sessionId!, 'foreign-descendant'),
      context('33333333-3333-4333-8333-333333333333', root.id, 'foreign-task'),
    ]
    const targets = [child.sessionId!, grandchild.sessionId!, child.sessionId!, child.sessionId!]
    for (let index = 0; index < foreignContexts.length; index++) {
      const foreign = foreignContexts[index]!
      const target = targets[index]!
      await expect(service.prompt({ sessionId: target, prompt: 'Probe.' }, foreign)).rejects.toMatchObject({ kind: 'not_found' })
      await expect(service.wait({ sessionId: target, afterSeq: 0, until: 'ready', timeoutMs: 0 }, foreign)).rejects.toMatchObject({ kind: 'not_found' })
      await expect(service.cancel({ sessionId: target }, foreign)).rejects.toMatchObject({ kind: 'not_found' })
    }
  })

  it('allows only the direct owner to read a delegated child', async () => {
    const root = await managedCaller()
    const sibling = await managedCaller(root.taskId)
    const child = await service.spawn({ title: 'Child', prompt: 'Report.', isolation: 'shared' }, context(root.taskId, root.id))
    const grandchild = await service.spawn({ title: 'Grandchild', prompt: 'Report.', isolation: 'shared' }, context(root.taskId, child.sessionId!, 'nested'))

    await expect(service.read({ sessionId: child.sessionId!, afterSeq: 0, limit: 10 }, context(root.taskId, sibling.id)))
      .rejects.toMatchObject({ kind: 'not_found' })
    await expect(service.read({ sessionId: grandchild.sessionId!, afterSeq: 0, limit: 10 }, context(root.taskId, root.id)))
      .rejects.toMatchObject({ kind: 'not_found' })
    await expect(service.read({ sessionId: child.sessionId!, afterSeq: 0, limit: 10 }, context(root.taskId, grandchild.sessionId!)))
      .rejects.toMatchObject({ kind: 'not_found' })
    await expect(service.read({ sessionId: child.sessionId!, afterSeq: 0, limit: 10 }, context('33333333-3333-4333-8333-333333333333', root.id)))
      .rejects.toMatchObject({ kind: 'not_found' })
  })
})
