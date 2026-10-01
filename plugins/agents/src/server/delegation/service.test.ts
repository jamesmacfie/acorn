import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { ToolContext } from '@acorn/plugin-api/node'
import type { AgentProviderDescriptor, AgentRequestKind } from '../../contract/wire.ts'
import type { TerminalSession } from '@acorn/plugin-terminal/contract/wire.ts'
import { AgentStore } from '../sessions/store'
import type { ManagedAgentRuntime } from '../sessions/runtime'
import { AgentDelegationStore } from './store'
import { AgentDelegationService } from './service'
import type { CustomAgent } from '../../shared/customAgents'

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
  let customAgents: CustomAgent[]
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
    customAgents = []
    runtime = {
      store: sessions,
      usableProvider: async (pick: (provider: typeof PROVIDER) => boolean) => [PROVIDER].find(pick),
      customAgents: async () => customAgents,
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

  it('starts a custom agent by name, with its options and a ceiling no wider than its own', async () => {
    customAgents = [{
      id: 'agent-1', name: 'Bug reviewer', providerId: 'codex', profileId: 'codex',
      options: { reasoning: 'high', model: 'gpt-codex' }, maxToolRisk: 'read', source: { kind: 'user' },
    }]
    const parent = await managedCaller()
    const result = await service.spawn({
      title: 'Review',
      prompt: 'Review the diff.',
      isolation: 'shared',
      agent: 'bug reviewer',
      configOptions: { model: 'gpt-codex-mini' },
    }, context(parent.taskId, parent.id, 'custom-agent'))

    expect(runtime.acceptSession).toHaveBeenCalledWith(expect.objectContaining({ customAgentId: 'agent-1' }), expect.any(String))
    const child = await sessions.requireSession(result.sessionId!)
    // The caller's own choice for this child wins over the agent's.
    expect(child.config.requestedConfigOptions).toEqual({ reasoning: 'high', model: 'gpt-codex-mini' })
    expect(child.config.toolCeiling).toEqual({ allow: ['agent_spawn', 'agent_read', 'task_context'], maxRisk: 'read' })

    await expect(service.spawn(
      { title: 'Nobody', prompt: 'x', isolation: 'shared', agent: 'Missing' },
      context(parent.taskId, parent.id, 'missing-agent'),
    )).rejects.toThrow("No custom agent is called 'Missing'")
    await expect(service.spawn(
      { title: 'Clash', prompt: 'x', isolation: 'shared', agent: 'Bug reviewer', profileId: 'claude-code' },
      context(parent.taskId, parent.id, 'clashing-agent'),
    )).rejects.toThrow('Leave profileId out')
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

  it('withholds delegation from durable workflow sessions even without a config marker', async () => {
    const workflow = await sessions.createSession({
      taskId: '11111111-1111-4111-8111-111111111111', providerId: 'codex', profileId: 'codex',
      title: 'Workflow without legacy metadata', kind: 'workflow', config: {},
    }, PROVIDER)
    expect(await service.canSpawn(context(workflow.taskId, workflow.id))).toBe(false)
    await expect(service.spawn({ title: 'No', prompt: 'No', isolation: 'shared' }, context(workflow.taskId, workflow.id)))
      .rejects.toMatchObject({ kind: 'not_found' })
    expect(runtime.acceptSession).not.toHaveBeenCalled()
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

  describe('reports to the owner', () => {
    const finish = async (sessionId: string, turnId: string, text: string) => {
      await sessions.startTurn(turnId)
      await sessions.recordEvent(sessionId, turnId, { type: 'assistant_message', text })
      await sessions.recordEvent(sessionId, turnId, { type: 'turn_completed', stopReason: 'end_turn' })
    }
    const reports = async (sessionId: string) =>
      (await sessions.snapshot(sessionId)).turns.filter((turn) => turn.source === 'delegation_report')
    const block = async (
      sessionId: string,
      turnId: string,
      kind: AgentRequestKind,
      requestId = `${kind}-request`,
      detail = 'Review the requested action.',
    ) => {
      await sessions.startTurn(turnId)
      await sessions.recordEvent(sessionId, turnId, {
        type: 'request', requestId, kind, title: 'Child needs input', detail,
      })
      await service.reports.deliverRequest(sessionId, requestId)
      return (await sessions.request(sessionId, requestId))!
    }

    it('marks the child turn with its owner and tells the child its role', async () => {
      const { parent, child } = await spawnChild()
      const turn = await sessions.turn(child.turnId!)
      expect(turn?.effectivePolicy.reportTo).toBe(parent.id)
      expect(turn?.input).toContainEqual(expect.objectContaining({ type: 'context', source: 'delegation', label: 'Parent' }))
    })

    it('queues one report with the final message when the child turn settles', async () => {
      const { parent, child } = await spawnChild()
      await finish(child.sessionId!, child.turnId!, 'All tests pass.')

      await service.reports.deliver(child.turnId!)
      await service.reports.deliver(child.turnId!)

      const queued = await reports(parent.id)
      expect(queued).toHaveLength(1)
      expect(queued[0]!.status).toBe('queued')
      expect(queued[0]!.input[0]).toMatchObject({ type: 'text', text: expect.stringContaining('All tests pass.') })
      expect(queued[0]!.input).toContainEqual(expect.objectContaining({
        type: 'context', source: 'delegation_report', label: 'Child', resourceId: child.sessionId,
      }))
    })

    it.each([
      ['permission', 'permission'],
      ['question', 'an answer'],
      ['elicitation', 'elicitation input'],
    ] as const)('reports a pending %s request to the owner once', async (kind, need) => {
      const { parent, child } = await spawnChild()
      const request = await block(child.sessionId!, child.turnId!, kind)
      await service.reports.deliverRequest(child.sessionId!, request.providerRequestId)

      const queued = await reports(parent.id)
      expect(queued).toHaveLength(1)
      expect(queued[0]).toMatchObject({
        source: 'delegation_report',
        status: 'queued',
        effectivePolicy: { reportFrom: { sessionId: child.sessionId, turnId: child.turnId } },
      })
      expect(queued[0]!.input[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining(`Child is blocked and needs ${need}.`),
      })
      expect(queued[0]!.input[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining('A human must resolve it in the child session'),
      })
      expect(queued[0]!.input).toContainEqual(expect.objectContaining({
        type: 'context', source: 'delegation_report', label: 'Child', resourceId: child.sessionId,
        deepLink: { pane: 'agents', intent: { sessionId: child.sessionId } },
      }))
      expect(await sessions.request(child.sessionId!, request.providerRequestId)).toMatchObject({
        id: request.id, status: 'pending', resolution: null,
      })
    })

    it('keeps request detail bounded and uses the request row id for replay protection', async () => {
      const { parent, child } = await spawnChild()
      const request = await block(child.sessionId!, child.turnId!, 'permission', 'provider-request', 's'.repeat(2_000))
      await service.reports.deliverRequest(child.sessionId!, request.providerRequestId)

      const [report] = await reports(parent.id)
      expect(report?.input[0]).toMatchObject({ type: 'text', text: expect.stringContaining('s'.repeat(400)) })
      expect((report!.input[0] as { text: string }).text).not.toContain('s'.repeat(501))
      expect(await sessions.turnForIdempotency(parent.id, `delegation-request:${request.id}`)).toMatchObject({ id: report?.id })
      expect(await reports(parent.id)).toHaveLength(1)
    })

    it('leaves an earlier interactive turn ahead of a blocked-request report', async () => {
      const { parent, child } = await spawnChild()
      const { turn: interactive } = await sessions.enqueueTurn(parent.id, {
        input: [{ type: 'text', text: 'User work first.' }],
        source: 'interactive', effectivePolicy: {}, idempotencyKey: 'interactive-before-request',
      })
      await block(child.sessionId!, child.turnId!, 'question')

      const [report] = await reports(parent.id)
      expect(interactive.ordinal).toBeLessThan(report!.ordinal)
      expect((await sessions.nextQueuedTurn(parent.id))?.id).toBe(interactive.id)
    })

    it('does not report a request in a manually entered child turn', async () => {
      const { parent, child } = await spawnChild()
      const { turn } = await sessions.enqueueTurn(child.sessionId!, {
        input: [{ type: 'text', text: 'Manual follow-up.' }],
        source: 'interactive', effectivePolicy: {}, idempotencyKey: 'manual-child-turn',
      })
      await block(child.sessionId!, turn.id, 'permission', 'manual-request')

      expect(await reports(parent.id)).toHaveLength(0)
    })

    it('requires reportTo on the request turn even when the session has a parent', async () => {
      const { parent, child } = await spawnChild()
      const { turn } = await sessions.enqueueTurn(child.sessionId!, {
        input: [{ type: 'text', text: 'Unaddressed delegation.' }],
        source: 'delegation', effectivePolicy: {}, idempotencyKey: 'unaddressed-delegation',
      })
      await block(child.sessionId!, turn.id, 'permission', 'unaddressed-request')

      expect(await reports(parent.id)).toHaveLength(0)
    })

    it('cannot route a child request to another session through reportTo alone', async () => {
      const { parent, child } = await spawnChild()
      const other = await managedCaller(parent.taskId)
      const { turn } = await sessions.enqueueTurn(child.sessionId!, {
        input: [{ type: 'text', text: 'Forged delegated turn.' }],
        source: 'delegation', effectivePolicy: { reportTo: other.id }, idempotencyKey: 'foreign-report-to',
      })
      await block(child.sessionId!, turn.id, 'question', 'foreign-request')

      expect(await reports(parent.id)).toHaveLength(0)
      expect(await reports(other.id)).toHaveLength(0)
    })

    it('does not report a terminal-owned child request without a managed owner', async () => {
      const taskId = '11111111-1111-4111-8111-111111111111'
      terminals.push(terminal('terminal-owner', taskId))
      const child = await service.spawn(
        { title: 'Terminal child', prompt: 'Go.', isolation: 'shared' },
        context(taskId, 'terminal-owner', 'terminal-request-spawn'),
      )
      const request = await block(child.sessionId!, child.turnId!, 'elicitation')

      expect((await sessions.turn(child.turnId!))?.effectivePolicy.reportTo).toBeUndefined()
      expect(await sessions.request(child.sessionId!, request.providerRequestId)).toMatchObject({ status: 'pending' })
      expect(await reports(child.sessionId!)).toHaveLength(0)
    })

    it('does not recreate request reports for expired requests during startup reconciliation', async () => {
      const { parent, child } = await spawnChild()
      await sessions.startTurn(child.turnId!)
      await sessions.recordEvent(child.sessionId!, child.turnId, {
        type: 'request', requestId: 'expired-request', kind: 'permission', title: 'Approval needed',
      })
      await sessions.expirePendingRequests(child.sessionId!)

      await reconcileAfterRestart()

      expect(await sessions.request(child.sessionId!, 'expired-request')).toMatchObject({ status: 'expired' })
      expect(await reports(parent.id)).toHaveLength(0)
    })

    it('does not report a turn before it settles, or to a terminal owner', async () => {
      const { parent, child } = await spawnChild()
      await service.reports.deliver(child.turnId!)
      expect(await reports(parent.id)).toHaveLength(0)

      const taskId = '11111111-1111-4111-8111-111111111111'
      terminals.push(terminal('terminal-owner', taskId))
      const fromTerminal = await service.spawn(
        { title: 'Terminal child', prompt: 'Go.', isolation: 'shared' },
        context(taskId, 'terminal-owner', 'terminal-spawn'),
      )
      expect((await sessions.turn(fromTerminal.turnId!))?.effectivePolicy.reportTo).toBeUndefined()
    })

    it('withdraws a queued report once the owner reads the result itself', async () => {
      const { parent, child } = await spawnChild()
      await finish(child.sessionId!, child.turnId!, 'Done.')
      await service.reports.deliver(child.turnId!)

      await service.read({ sessionId: child.sessionId!, afterSeq: 0, limit: 50 }, context(parent.taskId, parent.id, 'read'))

      expect((await reports(parent.id)).map((turn) => turn.status)).toEqual(['cancelled'])
    })

    it('does not report a turn the owner cancelled', async () => {
      const { parent, child } = await spawnChild()
      await service.cancel({ sessionId: child.sessionId!, turnId: child.turnId! }, context(parent.taskId, parent.id, 'cancel'))

      await service.reports.deliver(child.turnId!)

      expect(await reports(parent.id)).toHaveLength(0)
    })

    it('queues a report the last process missed when it reconciles', async () => {
      const { parent, child } = await spawnChild()
      await finish(child.sessionId!, child.turnId!, 'Finished before the restart.')

      await reconcileAfterRestart()

      expect(await reports(parent.id)).toHaveLength(1)
    })
  })
})
