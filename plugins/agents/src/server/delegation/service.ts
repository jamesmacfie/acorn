import { ToolError, type ToolContext } from '@acorn/plugin-api/node'
import type {
  AgentSession,
  AgentSessionDelegation,
  AgentSessionList,
  AgentSessionSnapshot,
  AgentTurn,
} from '@acorn/protocol/managedAgents.ts'
import type { TerminalSession } from '@acorn/protocol/terminal.ts'
import type {
  AgentCancelInput,
  AgentPromptInput,
  AgentReadInput,
  AgentSpawnInput,
  AgentWaitInput,
} from '../../shared/delegationSchemas'
import type { ManagedAgentRuntime } from '../sessions/runtime'
import {
  assistantResult,
  parseStructuredResult,
  promptWithResultContract,
} from '../sessions/resultContract'
import {
  assertBoundedDelegationConfig,
  assertDelegationResultSchema,
  delegatedToolCeiling,
  sessionMayDelegate,
} from './policy'
import { foldReadableEvents, type AgentReadResult } from './readProjection'
import {
  AgentDelegationStore,
  DelegationLimitError,
  type AgentSpawn,
} from './store'
import { WorktreeProvisioning, type WorktreeTaskService } from './worktreeProvisioning'

type Caller = {
  taskId: string
  sessionId: string
  profileId: string
  managedSession: AgentSession | null
  parentTurnId: string | null
}

export type AgentSpawnResult = {
  spawnId: string
  taskId: string
  sessionId: string | null
  turnId: string | null
  depth: number
  provisioningState: AgentSpawn['provisioningState']
  cursor: number
  error?: string
}

export type AgentPromptResult = {
  sessionId: string
  turnId: string
  queueState: AgentTurn['status']
  queueOrdinal: number
  state: AgentSession['runtimeState']
  cursor: number
}

export type AgentWaitResult = {
  sessionId: string
  until: AgentWaitInput['until']
  matched: boolean
  timedOut: boolean
  state: AgentSession['runtimeState']
  attention: AgentSession['attention']
  lastSeq: number
}

export type AgentCancelResult = {
  sessionId: string
  cancelledTurnId: string
  state: AgentSession['runtimeState']
}

const operationKey = (context: ToolContext, tool: 'agent_prompt' | 'agent_cancel'): string =>
  `${context.taskId}:${context.sessionId}:${tool}:${context.callId}`

const waitConditionMet = (snapshot: AgentSessionSnapshot, until: AgentWaitInput['until']): boolean => {
  if (until === 'ready') return snapshot.session.runtimeState === 'ready'
  if (until === 'attention') return !['none', 'unread'].includes(snapshot.session.attention)
  if (until === 'stopped') return ['stopped', 'failed', 'archived'].includes(snapshot.session.runtimeState)
  return snapshot.events.some((record) =>
    record.event.type === 'turn_completed' || record.event.type === 'error')
}

const turnResultSchema = (turn: AgentTurn): object | undefined => {
  const value = turn.effectivePolicy.resultSchema ?? turn.effectivePolicy.schema
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

const spawnResult = (spawn: AgentSpawn): AgentSpawnResult => ({
    spawnId: spawn.id,
    taskId: spawn.childTaskId,
    sessionId: spawn.childSessionId,
    turnId: spawn.childTurnId,
    depth: spawn.depth,
    provisioningState: spawn.provisioningState,
    // A newly created session's ledger begins at zero. Keep this replay-stable even when provider
    // startup has appended metadata by the time an idempotent retry arrives.
    cursor: 0,
    ...(spawn.error ? { error: spawn.error } : {}),
})

/** Plugin-owned orchestration over the managed runtime and its database. */
export class AgentDelegationService {
  private readonly inFlight = new Map<string, Promise<AgentSpawnResult>>()
  private readonly promptInFlight = new Map<string, Promise<AgentPromptResult>>()
  private readonly cancelInFlight = new Map<string, Promise<AgentCancelResult>>()
  private readonly worktrees: WorktreeProvisioning

  constructor(
    private readonly runtime: ManagedAgentRuntime,
    readonly store: AgentDelegationStore,
    private readonly terminalSessions: () => Promise<TerminalSession[]>,
    tasks?: WorktreeTaskService,
    private readonly reconciled: Promise<void> = Promise.resolve(),
  ) {
    this.worktrees = new WorktreeProvisioning(runtime, store, tasks)
  }

  async canSpawn(context: ToolContext): Promise<boolean> {
    try {
      await this.reconciled
      const caller = await this.caller(context)
      return !caller.managedSession || sessionMayDelegate(caller.managedSession)
    } catch {
      return false
    }
  }

  /** Add task-bounded display lineage without exposing the authority row or terminal owner id. */
  async projectSessionList(page: AgentSessionList): Promise<AgentSessionList> {
    const visibility = await this.store.visibilityForSessions(page.sessions)
    if (!visibility.length) return { ...page, delegations: [] }
    const sessions = new Map(page.sessions.map((session) => [session.id, session]))
    const terminals = visibility.some((item) => !item.managedParentSessionId)
      ? await this.terminalSessions()
      : []
    const delegations: AgentSessionDelegation[] = []
    for (const item of visibility) {
      const child = sessions.get(item.sessionId)
      if (!child) continue
      if (item.managedParentSessionId) {
        delegations.push({
          sessionId: item.sessionId,
          depth: item.depth,
          isolation: item.isolation,
          owner: { kind: 'managed', parentSessionId: item.managedParentSessionId },
        })
        continue
      }
      const terminal = terminals.find((candidate) =>
        candidate.id === item.ownerSessionId && candidate.taskId === item.ownerTaskId)
      delegations.push({
        sessionId: item.sessionId,
        depth: item.depth,
        isolation: item.isolation,
        owner: {
          kind: 'terminal',
          label: terminal?.title ?? 'Terminal agent',
          profileId: terminal?.profileId ?? null,
        },
      })
    }
    return { ...page, delegations }
  }

  async spawn(input: AgentSpawnInput, context: ToolContext): Promise<AgentSpawnResult> {
    await this.reconciled
    if (!context.callId) throw new ToolError('bad_request', 'agent_spawn requires a stable tool call id.')
    const sessionId = context.sessionId
    if (!sessionId) throw new ToolError('not_found', 'Session not found.')
    assertBoundedDelegationConfig(input.resultSchema, 'The result schema')
    assertBoundedDelegationConfig(input.configOptions, 'Provider configuration')
    assertDelegationResultSchema(input.resultSchema)
    const operationKey = `${context.taskId}:${sessionId}:agent_spawn:${context.callId}`
    const running = this.inFlight.get(operationKey)
    if (running) return running
    const operation = this.spawnOnce(input, context, `agent_spawn:${context.callId}`)
    this.inFlight.set(operationKey, operation)
    void operation.finally(() => this.inFlight.delete(operationKey)).catch(() => undefined)
    return operation
  }

  async prompt(input: AgentPromptInput, context: ToolContext): Promise<AgentPromptResult> {
    await this.reconciled
    if (!context.callId) throw new ToolError('bad_request', 'agent_prompt requires a stable tool call id.')
    assertBoundedDelegationConfig(input.resultSchema, 'The result schema')
    assertBoundedDelegationConfig(input.configOptions, 'Provider configuration')
    assertDelegationResultSchema(input.resultSchema)
    const { session } = await this.ownedSession(context, input.sessionId)
    const key = operationKey(context, 'agent_prompt')
    const replay = await this.runtime.store.operationResult<AgentPromptResult>(key, 'delegation.prompt')
    if (replay) return replay
    const running = this.promptInFlight.get(key)
    if (running) return running
    const operation = this.promptOnce(input, session, key)
    this.promptInFlight.set(key, operation)
    void operation.finally(() => this.promptInFlight.delete(key)).catch(() => undefined)
    return operation
  }

  private async promptOnce(
    input: AgentPromptInput,
    session: AgentSession,
    key: string,
  ): Promise<AgentPromptResult> {
    if (session.controller !== 'acorn') {
      throw new ToolError('conflict', `The child session is controlled by ${session.controller}.`)
    }
    if (session.archivedAt || session.runtimeState === 'archived' || session.runtimeState === 'failed') {
      throw new ToolError('conflict', `The child session cannot accept a turn while it is ${session.runtimeState}.`)
    }
    if (input.configOptions && Object.keys(input.configOptions).length) {
      const [active, queued] = await Promise.all([
        this.runtime.store.activeTurn(session.id),
        this.runtime.store.nextQueuedTurn(session.id),
      ])
      if (active || queued) {
        throw new ToolError('conflict', 'Provider configuration can only change while the child turn queue is idle.')
      }
      await this.runtime.applyRequestedConfig(session.id, input.configOptions)
    }
    const cursor = (await this.runtime.store.requireSession(session.id)).lastEventSeq
    const turn = await this.runtime.enqueueTurn(session.id, {
      input: [{ type: 'text', text: promptWithResultContract(input.prompt, input.resultSchema) }],
      source: 'delegation',
      effectivePolicy: {
        ...(input.resultSchema ? { resultSchema: input.resultSchema } : {}),
        ...(input.configOptions ? { configOptions: input.configOptions } : {}),
      },
      idempotencyKey: key,
    })
    const result: AgentPromptResult = {
      sessionId: session.id,
      turnId: turn.id,
      queueState: turn.status,
      queueOrdinal: turn.ordinal,
      state: session.runtimeState,
      cursor,
    }
    await this.runtime.store.saveOperation(key, 'delegation.prompt', result, turn.id)
    return result
  }

  async wait(input: AgentWaitInput, context: ToolContext): Promise<AgentWaitResult> {
    await this.reconciled
    await this.ownedSession(context, input.sessionId)
    const snapshot = await this.runtime.wait(input.sessionId, input.afterSeq, input.until, input.timeoutMs)
    const matched = waitConditionMet(snapshot, input.until)
    return {
      sessionId: input.sessionId,
      until: input.until,
      matched,
      timedOut: !matched,
      state: snapshot.session.runtimeState,
      attention: snapshot.session.attention,
      lastSeq: snapshot.session.lastEventSeq,
    }
  }

  private async spawnOnce(
    input: AgentSpawnInput,
    context: ToolContext,
    idempotencyKey: string,
  ): Promise<AgentSpawnResult> {
    const caller = await this.caller(context)
    if (caller.managedSession && !sessionMayDelegate(caller.managedSession)) {
      throw new ToolError('not_found', 'Session not found.')
    }
    const replay = await this.store.forCall(caller.taskId, caller.sessionId, idempotencyKey)
    if (replay?.provisioningState === 'provisioned' || replay?.provisioningState === 'failed') {
      return spawnResult(replay)
    }
    const providers = await this.runtime.providers()
    const profileId = input.profileId ?? caller.profileId
    const provider = providers.find((candidate) => candidate.profileId === profileId)
    if (!provider) throw new ToolError('bad_request', `Profile '${profileId}' does not support managed sessions.`)
    if (!provider.installed || provider.authenticated === false) {
      throw new ToolError('bad_request', provider.diagnostics[0] ?? `Profile '${profileId}' is unavailable.`)
    }
    const toolCeiling = delegatedToolCeiling(context.toolCeiling, input.toolCeiling)
    let reserved: ReturnType<AgentDelegationStore['reserveShared']>
    try {
      reserved = input.isolation === 'worktree'
        ? this.store.reserveWorktree({
            ownerTaskId: caller.taskId,
            ownerSessionId: caller.sessionId,
            idempotencyKey,
            provisioning: {
              title: input.title,
              prompt: input.prompt,
              branch: input.title,
              providerId: provider.id,
              profileId: provider.profileId,
              parentSessionId: caller.managedSession?.id ?? null,
              parentTurnId: caller.parentTurnId,
              toolCeiling,
              ...(input.resultSchema ? { resultSchema: input.resultSchema } : {}),
              ...(input.configOptions ? { configOptions: input.configOptions } : {}),
            },
          })
        : this.store.reserveShared({
            ownerTaskId: caller.taskId,
            ownerSessionId: caller.sessionId,
            idempotencyKey,
          })
    } catch (error) {
      if (error instanceof DelegationLimitError) throw new ToolError('bad_request', error.message)
      throw error
    }
    if (reserved.spawn.provisioningState === 'provisioned') return spawnResult(reserved.spawn)
    if (reserved.spawn.provisioningState === 'failed') return spawnResult(reserved.spawn)

    if (reserved.spawn.isolation === 'worktree') {
      try {
        return spawnResult(await this.worktrees.provision(reserved.spawn))
      } catch (error) {
        return spawnResult(await this.store.fail(reserved.spawn.id, error))
      }
    }

    let childSessionId: string | undefined
    let childTurnId: string | undefined
    try {
      const session = await this.runtime.acceptSession({
        taskId: caller.taskId,
        providerId: provider.id,
        profileId: provider.profileId,
        title: input.title,
        kind: 'delegated',
        parentSessionId: caller.managedSession?.id,
        parentTurnId: caller.parentTurnId ?? undefined,
        config: {
          delegationSpawnId: reserved.spawn.id,
          toolCeiling,
          ...(input.resultSchema ? { resultSchema: input.resultSchema } : {}),
          ...(input.configOptions ? { requestedConfigOptions: input.configOptions } : {}),
        },
      }, `delegation:${reserved.spawn.id}:session`)
      childSessionId = session.id
      const turn = await this.runtime.enqueueTurn(session.id, {
        input: [{ type: 'text', text: promptWithResultContract(input.prompt, input.resultSchema) }],
        source: 'delegation',
        effectivePolicy: {
          delegationSpawnId: reserved.spawn.id,
          toolCeiling,
          ...(input.resultSchema ? { resultSchema: input.resultSchema } : {}),
          ...(input.configOptions ? { configOptions: input.configOptions } : {}),
        },
        idempotencyKey: `delegation:${reserved.spawn.id}:turn`,
      })
      childTurnId = turn.id
      return spawnResult(await this.store.complete(reserved.spawn.id, session.id, turn.id))
    } catch (error) {
      const failed = await this.store.fail(reserved.spawn.id, error, {
        sessionId: childSessionId,
        turnId: childTurnId,
      })
      return spawnResult(failed)
    }
  }

  /** Finish every cross-database worktree spawn that was durably reserved before the last exit. */
  async reconcile(): Promise<void> {
    await this.worktrees.reconcile()
  }

  async read(input: AgentReadInput, context: ToolContext): Promise<AgentReadResult> {
    await this.reconciled
    const { session } = await this.ownedSession(context, input.sessionId)
    const page = await this.runtime.store.eventPage(input.sessionId, input.afterSeq, input.limit)
    const items = foldReadableEvents(page.events)
    const terminalTurns = new Map<string, number>()
    for (const record of page.events) {
      if (!record.turnId) continue
      if (record.event.type === 'turn_completed' || record.event.type === 'error') {
        terminalTurns.set(record.turnId, record.seq)
      }
    }
    for (const [turnId, seq] of terminalTurns) {
      const turn = await this.runtime.store.turn(turnId)
      if (!turn || turn.sessionId !== session.id) continue
      const resultSchema = turnResultSchema(turn)
      if (!resultSchema) continue
      const text = assistantResult(await this.runtime.store.eventsForTurn(turnId))
      const value = text ? parseStructuredResult(text, resultSchema) : null
      if (value != null && JSON.stringify(value).length <= 64 * 1024) {
        items.push({ type: 'structured_output', value, turnId, seq })
      } else {
        items.push({
          type: 'diagnostic',
          level: 'warning',
          message: 'The child returned no output that matches the declared result schema.',
          turnId,
          seq,
        })
      }
    }
    return {
      sessionId: input.sessionId,
      state: session.runtimeState,
      attention: session.attention,
      items,
      nextCursor: page.events.at(-1)?.seq ?? input.afterSeq,
      hasMore: page.nextCursor != null,
    }
  }

  async cancel(input: AgentCancelInput, context: ToolContext): Promise<AgentCancelResult> {
    await this.reconciled
    if (!context.callId) throw new ToolError('bad_request', 'agent_cancel requires a stable tool call id.')
    const { session } = await this.ownedSession(context, input.sessionId)
    const key = operationKey(context, 'agent_cancel')
    const replay = await this.runtime.store.operationResult<AgentCancelResult>(key, 'delegation.cancel')
    if (replay) return replay
    const running = this.cancelInFlight.get(key)
    if (running) return running
    const operation = this.cancelOnce(input, session, key)
    this.cancelInFlight.set(key, operation)
    void operation.finally(() => this.cancelInFlight.delete(key)).catch(() => undefined)
    return operation
  }

  private async cancelOnce(
    input: AgentCancelInput,
    session: AgentSession,
    key: string,
  ): Promise<AgentCancelResult> {
    const target = input.turnId
      ? await this.runtime.store.turn(input.turnId)
      : await this.runtime.store.activeTurn(session.id)
    if (!target || target.sessionId !== session.id) {
      if (input.turnId) throw new ToolError('not_found', 'Turn not found.')
      throw new ToolError('conflict', 'The child has no active turn.')
    }
    if (!['queued', 'dispatching', 'active'].includes(target.status)) {
      throw new ToolError('conflict', `The child turn is already ${target.status}.`)
    }
    await this.runtime.cancelTurn(session.id, target.id)
    const resultingSession = await this.runtime.store.requireSession(session.id)
    const result: AgentCancelResult = {
      sessionId: session.id,
      cancelledTurnId: target.id,
      state: resultingSession.runtimeState,
    }
    await this.runtime.store.saveOperation(key, 'delegation.cancel', result, target.id)
    return result
  }

  private async ownedSession(
    context: ToolContext,
    childSessionId: string,
  ): Promise<{ spawn: AgentSpawn; session: AgentSession }> {
    const ownerSessionId = context.sessionId
    if (!ownerSessionId) throw new ToolError('not_found', 'Session not found.')
    const spawn = await this.store.ownedChild(context.taskId, ownerSessionId, childSessionId)
    if (!spawn) throw new ToolError('not_found', 'Session not found.')
    const session = await this.runtime.store.getSession(childSessionId)
    if (!session || session.taskId !== spawn.childTaskId) throw new ToolError('not_found', 'Session not found.')
    return { spawn, session }
  }

  private async caller(context: ToolContext): Promise<Caller> {
    if (!context.sessionId) throw new ToolError('not_found', 'Session not found.')
    const managed = await this.runtime.store.getSession(context.sessionId)
    if (managed) {
      if (managed.taskId !== context.taskId) throw new ToolError('not_found', 'Session not found.')
      return {
        taskId: context.taskId,
        sessionId: context.sessionId,
        profileId: managed.profileId,
        managedSession: managed,
        parentTurnId: (await this.runtime.store.activeTurn(managed.id))?.id ?? null,
      }
    }
    const terminal = (await this.terminalSessions()).find((candidate) =>
      candidate.id === context.sessionId && candidate.taskId === context.taskId)
    if (!terminal) throw new ToolError('not_found', 'Session not found.')
    return {
      taskId: context.taskId,
      sessionId: context.sessionId,
      profileId: terminal.profileId,
      managedSession: null,
      parentTurnId: null,
    }
  }
}
