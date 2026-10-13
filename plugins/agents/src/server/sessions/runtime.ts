import type {
  AgentDeleteResult,
  AgentProviderDescriptor,
  AgentRequest,
  AgentSession,
  AgentSessionSnapshot,
  AgentTurn,
} from '../../contract/wire.ts'
import type { CreateAgentSessionInput, EnqueueAgentTurnInput } from '../../shared/schemas'
import {
  assertBoundedJson,
  MAX_AGENT_CONFIG_BYTES,
  MAX_AGENT_RESOLUTION_BYTES,
  validateAgentInputFiles,
} from './inputValidation'
import type { AgentLoopHookReply, AgentLoopHookRequest } from '../../contract/loopHook.ts'
import { ManagedAgentEngine, type AgentRuntimeOptions, type WaitCondition } from './runtimeEngine'
import { mergeSessionConfigChange, retainSessionAuthority } from './sessionConfigMerge'
import { sessionMcpSelection, type AgentSessionMcp } from '../../shared/mcpServers'
import { customAgentRegistry, readCustomAgents } from '../customAgents'
import { customAgentSnapshot, sessionCustomAgent, type CustomAgent } from '../../shared/customAgents'
import { delegatedToolCeiling } from '../delegation/policy'
import { parseToolCeiling } from '@acorn/protocol/toolPolicy.ts'
import { SessionTitleGeneration } from './sessionTitleGeneration'
import { SessionDefaultsCommands } from './sessionDefaultsCommands'
import type { TranscriptCommands } from './transcriptCommands'
import { waitForSessionSnapshot } from './sessionWait'
import { CODEX_PLAN_IMPLEMENTATION_PROMPT } from '../../shared/codexPlanHandoff'
import { acceptCodexPlan } from '../drivers/codexPlanHandoff'
import { mergeSearchIndex } from './ledgerCompaction'
import { defaultSpawnedAgentDefaults, type SpawnedAgentDefaults } from '../../shared/sessionDefaults'
import { readAgentSessionDefaults } from '../sessionDefaultsStore'
import type { TurnAttendanceContext, WorkflowPosture } from './attendance'
import type { SessionSummaryInput } from '../../shared/sessionSummary'
import { agentDriverRegistry } from '../drivers/registry'
import { ProviderCatalogue } from './providerCatalogue'
import { sessionAccount } from '../../shared/accounts'
import type { AgentDriverRegistry } from '../drivers/registry'
import { isActiveSubagent } from './stateMachine'

// Events deleted per step by removeArchivedHistory. Each is a row and its search row. A step this size
// holds the node for milliseconds, and a larger one holds it longer for little gain.
const HISTORY_BATCH = 200

/**
 * A button answer must be one the stored request offered. The client builds its buttons from that
 * same list, so only a forged or stale answer fails here, and it fails before the claim: the request
 * stays open and nothing reaches the provider. A request that offered no buttons is left alone.
 */
const assertOfferedOption = (request: AgentRequest, resolution: unknown): void => {
  const optionId =
    typeof resolution === 'object' && resolution != null ? (resolution as { optionId?: unknown }).optionId : undefined
  if (typeof optionId !== 'string') return
  const offered = Array.isArray(request.payload.options) ? (request.payload.options as Array<{ id?: unknown }>) : []
  if (offered.length && !offered.some((option) => option?.id === optionId)) {
    throw new Error('That choice was not offered for this request.')
  }
}

/**
 * The managed-agent runtime: the one object routes, capabilities, and the composition root talk to.
 * Its methods are the session commands and lifecycle steps. Its fields are the collaborators a caller
 * reaches directly, each the owner of what it does. ManagedAgentEngine runs provider processes, records
 * events, and schedules turns underneath, and nothing outside this folder sees it.
 *
 * A test that drives the engine directly builds one and passes it in.
 */
export class ManagedAgentRuntime {
  readonly store: ManagedAgentEngine['store']
  readonly attachments: ManagedAgentEngine['attachments']
  readonly artifacts: ManagedAgentEngine['artifacts']
  readonly mcpServers: ManagedAgentEngine['mcpServers']
  readonly frames: ManagedAgentEngine['frames']
  readonly upkeep: ManagedAgentEngine['upkeep']
  readonly instructionAdmission: ManagedAgentEngine['instructionAdmission']
  readonly mcpReviews: ManagedAgentEngine['mcpReviews']
  readonly providers: ProviderCatalogue
  private readonly registry: AgentDriverRegistry
  private readonly core: AgentRuntimeOptions['core']
  private readonly db: AgentRuntimeOptions['db']
  private readonly currentUserId: AgentRuntimeOptions['currentUserId']
  private readonly standingContext: AgentRuntimeOptions['standingContext']
  private readonly hooks: AgentRuntimeOptions['hooks']
  private readonly telemetry: AgentRuntimeOptions['telemetry']
  private readonly startTerminalHandoff: AgentRuntimeOptions['startTerminalHandoff']
  private readonly terminalHandoffRunning: AgentRuntimeOptions['terminalHandoffRunning']
  // Bridge asks waiting on the person, by request id. holdAsk, reached through loopHook(), holds them
  // and resolveRequest() answers them.
  private readonly loopAsks = new Map<string, (resolution: unknown) => void>()

  constructor(
    options: AgentRuntimeOptions,
    private readonly engine = new ManagedAgentEngine(options),
  ) {
    this.store = engine.store
    this.attachments = engine.attachments
    this.artifacts = engine.artifacts
    this.mcpServers = engine.mcpServers
    this.frames = engine.frames
    this.upkeep = engine.upkeep
    this.instructionAdmission = engine.instructionAdmission
    this.mcpReviews = engine.mcpReviews
    this.registry = options.registry ?? agentDriverRegistry
    this.providers = new ProviderCatalogue(this.registry, engine.store, engine.accounts, engine.shutdownSignal)
    this.core = options.core
    this.db = options.db
    this.currentUserId = options.currentUserId
    this.standingContext = options.standingContext
    this.hooks = options.hooks
    this.telemetry = options.telemetry
    this.startTerminalHandoff = options.startTerminalHandoff
    this.terminalHandoffRunning = options.terminalHandoffRunning
    this.titleGeneration = this.createTitleGeneration()
    this.sessionDefaults = this.createSessionDefaults()
  }

  /**
   * Recovers what the last process left: sessions it was running are stopped, children it never heard
   * finish go idle, and turns it queued start draining. Called from the composition root after the
   * listener binds, because it interrupts every unsettled session (AGENTS_RUNTIME).
   */
  async reconcile(): Promise<void> {
    for (const session of await this.store.unsettledSessions()) {
      await this.store.interruptActiveTurn(session.id, 'Acorn restarted while the provider turn was active.')
      await this.store.expirePendingRequests(session.id)
      await this.engine.record(session.id, null, {
        type: 'session_state',
        state: 'stopped',
        detail: 'The provider process stopped when Acorn last exited. Send a prompt to resume.',
      })
    }
    // Nothing is streaming into a roster the previous process left behind, so any child still marked
    // active is one whose ending we will never hear. These sessions are not in `unsettledSessions`:
    // a backgrounded child leaves its parent `ready`, which is exactly why the row was stranded.
    for (const session of await this.store.sessionsWithActiveSubagents()) {
      for (const id of session.subagents.filter(isActiveSubagent).map((child) => child.id)) {
        await this.engine.record(session.id, null, { type: 'subagent', subagent: { id, status: 'idle' } })
      }
    }
    await this.store.requeueSteeringTurns()
    await this.engine.settleCommands()
    // No harness outlives the Node, so a background command still marked running lost the process that
    // would have reported its exit. Its session can be `ready`, which the rule above leaves running.
    for (const record of await this.store.unfinishedCommands()) {
      if (record.event.type !== 'tool' || !record.event.tool.background) continue
      await this.engine.record(record.sessionId, record.turnId, {
        type: 'tool',
        tool: {
          id: record.event.tool.id,
          title: '',
          kind: 'execute',
          status: 'unknown',
          subagentId: record.event.tool.subagentId,
        },
      })
    }
    await this.store.cancelWorkflowFollowUps()
    await this.attachments.collectGarbage()
    // A start's skill folder goes when its process stops. One left by a Node that died is removed here,
    // unless a session that started since is using it.
    await (
      await import('../drivers/skillFolder')
    ).sweepSkillFolders(this.engine.skillFolders, (sessionId) => this.engine.hasLiveSession(sessionId))
    await this.engine.webhooks.reconcile()
    await (await this.engine.goals.get()).recover()
    // Turns queued when the process last exited have nothing else to wake them: pump() runs on enqueue,
    // on a provider start, and when a turn settles, none of which happen on their own after a restart.
    // Not awaited, because draining spawns a provider child per session and boot waits on reconcile().
    void this.engine.pump()
    this.engine.compactLedgersInBackground()
  }

  /** One bridge call, for the session and task the caller's token names. */
  async loopHook(
    caller: { taskId: string; sessionId: string },
    request: AgentLoopHookRequest,
  ): Promise<AgentLoopHookReply> {
    const { answerLoopHook } = await import('./loopHooks')
    return answerLoopHook(
      {
        hooks: this.hooks,
        session: (sessionId) => this.store.getSession(sessionId),
        turn: (turnId) => this.store.turn(turnId),
        taskRoot: (taskId) => this.core.tasks.requireRoot(taskId),
        live: (sessionId) => this.engine.currentSession(sessionId),
        materialize: (sessionId, turnId, event) => this.engine.materialize(sessionId, turnId, event),
        accept: (pending) => this.engine.acceptProviderEvent(pending),
        expire: (sessionId, requestId) => this.store.expirePendingRequests(sessionId, requestId),
        asks: this.loopAsks,
      },
      caller,
      request,
    )
  }

  /** Read once per spawn so the delegation ledger can retain the resolved choices for recovery. */
  async spawnedAgentDefaults(): Promise<SpawnedAgentDefaults> {
    const userId = this.currentUserId()
    return userId ? (await readAgentSessionDefaults(this.core.prefs, userId)).spawned : defaultSpawnedAgentDefaults()
  }

  private readonly sessionInitializations = new Map<string, Promise<AgentSession>>()
  private readonly titleGeneration: SessionTitleGeneration
  private readonly sessionDefaults: SessionDefaultsCommands
  private transcripts: Promise<TranscriptCommands> | null = null

  private createTitleGeneration() {
    return new SessionTitleGeneration({
      store: this.store,
      models: this.core.models,
      currentUserId: this.currentUserId,
      publish: (session) => this.frames.emit({ channel: 'agent:session', session }),
      telemetry: this.telemetry,
    })
  }
  private createSessionDefaults() {
    return new SessionDefaultsCommands({
      store: this.store,
      prefs: this.core.prefs,
      currentUserId: this.currentUserId,
      patchSession: (sessionId, patch, options) => this.patchSession(sessionId, patch, options),
      recordWarning: async (sessionId, message) => {
        await this.engine.record(sessionId, null, { type: 'diagnostic', level: 'warning', message })
      },
    })
  }
  private transcriptCommands(): Promise<TranscriptCommands> {
    return (this.transcripts ??= import('./transcriptCommands').then(
      ({ TranscriptCommands }) =>
        new TranscriptCommands({
          store: this.store,
          providers: () => this.providers.list(),
          requireTaskRoot: (taskId) => this.core.tasks.requireRoot(taskId),
          record: async (sessionId, turnId, event) => {
            await this.engine.record(sessionId, turnId, event)
          },
          ensureSession: async (session) => {
            await this.engine.ensureSession(session)
          },
          publish: (session) => this.frames.emit({ channel: 'agent:session', session }),
        }),
    ))
  }

  async createSession(
    input: CreateAgentSessionInput,
    idempotencyKey?: string,
    posture?: WorkflowPosture,
  ): Promise<AgentSession> {
    const reserved = await this.reserveSession(input, idempotencyKey, posture)
    return reserved.created ? this.startCreatedSession(reserved.session) : reserved.session
  }

  /**
   * Interactive HTTP creation is acknowledged once the row is durable. The provider handshake keeps
   * running under runtime ownership and publishes its lifecycle over the existing agent WebSocket.
   * Internal workflow callers use createSession(), which returns once the session is ready.
   */
  async acceptSession(input: CreateAgentSessionInput, idempotencyKey?: string): Promise<AgentSession> {
    if (input.kind !== 'interactive' && input.kind !== 'delegated') return this.createSession(input, idempotencyKey)
    const reserved = await this.reserveSession(input, idempotencyKey)
    if (reserved.created) void this.startCreatedSession(reserved.session).catch(() => undefined)
    return reserved.session
  }

  private readonly reservations = new Set<Promise<{ session: AgentSession; created: boolean }>>()

  private reserveSession(
    input: CreateAgentSessionInput,
    idempotencyKey?: string,
    posture?: WorkflowPosture,
  ): Promise<{ session: AgentSession; created: boolean }> {
    const reservation = Promise.resolve().then(() => this.reserveSessionWave(input, idempotencyKey, posture))
    this.reservations.add(reservation)
    const settled = () => this.reservations.delete(reservation)
    void reservation.then(settled, settled)
    return reservation
  }

  private async reserveSessionWave(
    input: CreateAgentSessionInput,
    idempotencyKey?: string,
    posture?: WorkflowPosture,
  ): Promise<{ session: AgentSession; created: boolean }> {
    this.engine.shutdownSignal.throwIfAborted()
    assertBoundedJson('Agent session configuration', input.config, MAX_AGENT_CONFIG_BYTES)
    if (idempotencyKey) {
      const existing = await this.engine.readWhileRunning(() =>
        this.store.operationResult<AgentSession>(idempotencyKey, 'session.create'),
      )
      if (existing)
        return {
          session: await this.engine.readWhileRunning(() => this.store.requireSession(existing.id)),
          created: false,
        }
    }
    // The caller's choice, or the one a fork's config carries from its source, or else the harness's
    // default account. The HTTP route drops a client's own `config.account`, so a request names an
    // account only through `account`. A session resuming a provider reference stays on the login it
    // came from, because the CLI finds the reference only in that folder.
    const account =
      input.account ??
      sessionAccount(input.config) ??
      (input.resumeProviderSessionRef
        ? null
        : await this.engine.readWhileRunning(() => this.engine.accounts.defaultAccount(input.providerId)))
    const provider = await this.engine.readWhileRunning(() =>
      this.providers.usable((candidate) => candidate.id === input.providerId, account),
    )
    if (!provider) throw new Error(`Unknown agent provider: ${input.providerId}`)
    if (!provider.installed) throw new Error(provider.diagnostics[0] ?? `${provider.label} is unavailable.`)
    if (account) {
      const known = provider.accounts?.find((candidate) => candidate.name === account)
      if (!known) throw new Error(`${provider.label} has no account called '${account}' on this Node.`)
      if (known.authenticated === false) throw new Error(`The '${account}' ${provider.label} account is not signed in.`)
    } else if (provider.authenticated === false) {
      throw new Error(`${provider.label} is installed but its CLI account is not authenticated.`)
    }
    if (input.profileId !== provider.profileId) {
      throw new Error(`Provider '${provider.id}' requires profile '${provider.profileId}'.`)
    }
    await this.engine.readWhileRunning(() => this.core.tasks.requireRoot(input.taskId))
    // The servers switched on in Settings, decided here rather than taken from the caller: which
    // programs a session starts is the owner's setting, not something a request body can widen.
    const withAgent = await this.engine.readWhileRunning(() => this.withCustomAgent(input))
    const mcpServers = await this.engine.readWhileRunning(() => this.mcpServers.enabledNames())
    const standingContext = await this.engine.readWhileRunning(
      () => this.standingContext?.(input.taskId) ?? Promise.resolve(null),
    )
    this.engine.shutdownSignal.throwIfAborted()
    const { account: _account, ...config } = withAgent.config
    const session = await this.store.createSession(
      { ...withAgent, config: { ...config, mcpServers, standingContext, ...(account ? { account } : {}) } },
      provider,
      posture,
    )
    if (idempotencyKey) await this.store.saveOperation(idempotencyKey, 'session.create', session, session.id)
    return { session, created: true }
  }

  /** Makes the folder for a harness's next login. The person signs in by running the CLI's own login
   *  against it, so Acorn never handles the token (docs/managed-agents/accounts.md). */
  async addAccount(providerId: string, name: string): Promise<AgentProviderDescriptor[]> {
    if (!this.registry.create(providerId)?.accounts)
      throw new Error(`'${providerId}' doesn't support a second account.`)
    await this.engine.accounts.create(providerId, name)
    return this.providers.list(true)
  }

  /** What points a harness's CLI at the session's account, for a process the driver doesn't start,
   *  such as the terminal handoff. Empty for the default login. */
  async accountEnv(session: AgentSession): Promise<Record<string, string>> {
    const home = await this.engine.accountHome(session)
    if (!home) return {}
    const accounts = this.registry.create(session.providerId)?.accounts
    if (!accounts) throw new Error(`'${session.providerId}' doesn't support a second account.`)
    return { [accounts.env]: home }
  }

  /** Chooses the account new sessions of a harness start on when they name none. Null is the CLI's own
   *  login. */
  async setDefaultAccount(providerId: string, name: string | null): Promise<AgentProviderDescriptor[]> {
    if (!this.registry.create(providerId)?.accounts)
      throw new Error(`'${providerId}' doesn't support a second account.`)
    await this.engine.accounts.setDefaultAccount(providerId, name)
    return this.providers.list(true)
  }

  /** Sets an account's display name or icon. Null clears one. The folder keeps its name. */
  async setAccountDetails(
    providerId: string,
    name: string,
    change: { label?: string | null; icon?: string | null },
  ): Promise<AgentProviderDescriptor[]> {
    if (!this.registry.create(providerId)?.accounts)
      throw new Error(`'${providerId}' doesn't support a second account.`)
    await this.engine.accounts.setDetails(providerId, name, change)
    return this.providers.list(true)
  }

  /** Chooses whether every harness's accounts show by name or by icon. */
  async setAccountDisplay(show: 'name' | 'icon'): Promise<AgentProviderDescriptor[]> {
    await this.engine.accounts.setShowAs(show)
    return this.providers.list(true)
  }

  /** Signs the account out, then deletes its folder. A session pinned to it can no longer start. */
  async removeAccount(providerId: string, name: string): Promise<AgentProviderDescriptor[]> {
    const accounts = this.registry.create(providerId)?.accounts
    if (!accounts || !(await this.engine.accounts.has(providerId, name))) {
      throw new Error(`The '${name}' account for '${providerId}' was not found.`)
    }
    // Claude Code names its Keychain entry after the folder path, so deleting the folder alone would
    // leave the login behind for a later account given the same name.
    const executable = (await this.providers.list()).find((provider) => provider.id === providerId)?.executable
    const home = this.engine.accounts.home(providerId, name)
    if (executable)
      await (await import('../drivers/authProbe')).signOut(executable, accounts.logout, { [accounts.env]: home })
    await this.engine.accounts.remove(providerId, name)
    return this.providers.list(true)
  }

  /** The owner's custom agents and every plugin's, read per call because an account switch changes
   *  whose list this is. */
  async customAgents(): Promise<CustomAgent[]> {
    const userId = this.currentUserId()
    return userId ? readCustomAgents(this.core.prefs, userId) : customAgentRegistry.list()
  }

  /**
   * What a session started from a custom agent keeps: the snapshot the drivers read, the options to
   * apply once the provider has listed its own, and the tool ceiling. A ceiling the caller already set
   * is narrowed by the agent's, never replaced. A session with no `customAgentId` keeps whatever
   * `config` it was given, which is how a fork carries its source's snapshot; the HTTP route is where a
   * client's own `customAgent` is dropped.
   */
  private async withCustomAgent(input: CreateAgentSessionInput): Promise<CreateAgentSessionInput> {
    if (!input.customAgentId) return input
    const config = input.config
    const agent = (await this.customAgents()).find((candidate) => candidate.id === input.customAgentId)
    if (!agent) throw new Error('That custom agent no longer exists.')
    if (agent.providerId !== input.providerId) {
      throw new Error(`${agent.name} runs on '${agent.providerId}', not '${input.providerId}'.`)
    }
    const requested =
      typeof config.requestedConfigOptions === 'object' && config.requestedConfigOptions
        ? (config.requestedConfigOptions as Record<string, unknown>)
        : {}
    const agentCeiling = agent.maxToolRisk ? { maxRisk: agent.maxToolRisk } : undefined
    // An unreadable ceiling the caller sent removes every tool, the same as a corrupt persisted one.
    const ceiling =
      config.toolCeiling === undefined
        ? agentCeiling
        : delegatedToolCeiling(parseToolCeiling(config.toolCeiling) ?? { allow: [] }, agentCeiling)
    return {
      ...input,
      config: {
        ...config,
        customAgent: customAgentSnapshot(agent),
        requestedConfigOptions: { ...agent.options, ...requested },
        ...(ceiling ? { toolCeiling: ceiling } : {}),
      },
    }
  }

  private startCreatedSession(session: AgentSession): Promise<AgentSession> {
    const existing = this.sessionInitializations.get(session.id)
    if (existing) return existing
    const initialization = this.initializeCreatedSession(session)
    this.sessionInitializations.set(session.id, initialization)
    void initialization.then(
      () => this.sessionInitializations.delete(session.id),
      () => this.sessionInitializations.delete(session.id),
    )
    return initialization
  }

  private async initializeCreatedSession(session: AgentSession): Promise<AgentSession> {
    this.engine.holdSessionReadiness(session.id)
    try {
      const live = await this.engine.ensureSession(session)
      const signal = this.engine.sessionSignal(live)
      // Workflow steps and sessions with an origin set their own options. Forks retain theirs.
      if (session.kind === 'interactive' && !session.parentSessionId && !session.origin) {
        await this.sessionDefaults.applySaved(session.id, session.providerId, signal).catch(async (error) => {
          signal.throwIfAborted()
          await this.engine.record(session.id, null, {
            type: 'diagnostic',
            level: 'warning',
            message: `Your saved defaults could not be read for this session: ${error instanceof Error ? error.message : 'unknown error'}`,
          })
        })
      }
      // A custom agent's options go on top of the defaults above, so an agent that names only a model
      // still starts on the owner's reasoning level. Not for a fork, which copies the snapshot with the
      // rest of its source's config and continues at the settings its source was running.
      const startsFromAgent = !!sessionCustomAgent(session.config) && !session.parentSessionId
      if (session.kind === 'delegated' || session.origin?.kind === 'inline-diff' || startsFromAgent) {
        const requested = session.config.requestedConfigOptions
        if (requested && typeof requested === 'object' && !Array.isArray(requested)) {
          const values = Object.fromEntries(
            Object.entries(requested).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
          )
          await this.sessionDefaults.applyRequested(session.id, values, signal)
        }
      }
      signal.throwIfAborted()
      await this.engine.completeSessionReadiness(session.id)
      return this.store.requireSession(session.id)
    } catch (error) {
      this.engine.discardSessionReadinessHold(session.id)
      throw error
    }
  }

  private runtimeStop: Promise<void> | null = null

  stop(): Promise<void> {
    if (this.runtimeStop) return this.runtimeStop
    // Retire startup immediately, while title generation drains its own work.
    const engine = this.engine.stop()
    return (this.runtimeStop = (async () => {
      const drains = Promise.allSettled([...this.reservations, ...this.sessionInitializations.values()])
      const outcomes = await Promise.allSettled([this.titleGeneration.stop(), engine, drains])
      const failure = outcomes.find((outcome) => outcome.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
    })())
  }

  /** Applies workflow-selected provider options after the provider advertises its choices. */
  async applyRequestedConfig(sessionId: string, wanted: Record<string, string>): Promise<void> {
    await this.sessionDefaults.applyRequested(sessionId, wanted)
  }

  async importTranscript(input: {
    taskId: string
    providerId: string
    profileId: string
    title?: string
    content: string
  }): Promise<AgentSession> {
    return (await this.transcriptCommands()).import(input)
  }

  async verifyImportedResume(sessionId: string): Promise<AgentSession> {
    return (await this.transcriptCommands()).verifyResume(sessionId)
  }

  async enqueueTurn(
    sessionId: string,
    input: EnqueueAgentTurnInput,
    context: TurnAttendanceContext = {},
    signal?: AbortSignal,
  ): Promise<AgentTurn> {
    const { session, input: sent, outcome } = await this.engine.acceptTurn(sessionId, input, context, signal)
    const { turn } = outcome
    if (outcome.inserted && turn.ordinal === 0 && turn.source === 'interactive' && outcome.firstTurnFallback) {
      this.titleGeneration.start(session, sent, outcome.firstTurnFallback)
    }
    return turn
  }

  async implementCodexPlan(sessionId: string, itemId: string): Promise<AgentTurn> {
    const session = await this.store.requireSession(sessionId)
    if (
      session.controller !== 'acorn' ||
      session.kind !== 'interactive' ||
      session.driverKind !== 'codex-app-server' ||
      session.archivedAt
    ) {
      throw new Error('This session cannot implement a Codex plan.')
    }
    await this.core.tasks.requireRoot(session.taskId)
    const changed = await this.hooks?.run('before-send', {
      sessionId,
      taskId: session.taskId,
      text: CODEX_PLAN_IMPLEMENTATION_PROMPT,
    })
    if (changed && !changed.ok) throw new Error(`${changed.by}: ${changed.reason}`)
    const prompt = changed?.payload.text ?? CODEX_PLAN_IMPLEMENTATION_PROMPT
    if (!prompt.trim() || prompt.length > 1_000_000) throw new Error('The implementation prompt is invalid.')
    const { turn, inserted } = await this.core.checkoutAdmission.admitWork(session.taskId, () =>
      acceptCodexPlan(this.store, sessionId, itemId, prompt),
    )
    if (inserted) {
      const updated = await this.store.requireSession(sessionId)
      this.frames.emit({ channel: 'agent:session', session: updated })
      this.frames.emit({ channel: 'agent:turn', turn })
      void this.engine.pump().catch(() => undefined)
    }
    return turn
  }

  /** Regenerate the title from the first durable text prompt. */
  async regenerateTitle(sessionId: string): Promise<AgentSession> {
    return this.titleGeneration.regenerate(sessionId)
  }

  async summarizeSession(sessionId: string, userId: string, request: SessionSummaryInput, signal: AbortSignal) {
    const { generateSessionSummary } = await import('./sessionSummary')
    await this.engine.flushProviderEvents(sessionId)
    const snapshot = await this.store.exportSnapshot(sessionId)
    return generateSessionSummary(
      this.core.models,
      userId,
      snapshot,
      request,
      AbortSignal.any([signal, this.engine.shutdownSignal]),
    )
  }

  async setGoal(sessionId: string, objective: string | null): Promise<AgentSession> {
    return (await this.engine.goals.get()).set(sessionId, objective)
  }

  async resumeGoal(sessionId: string): Promise<AgentSession> {
    return (await this.engine.goals.get()).resume(sessionId)
  }

  // A raised concurrency limit must wake the pump without waiting for another turn or completion.
  drainQueue(): void {
    void this.engine.pump()
  }

  async cancelTurn(sessionId: string, turnId?: string): Promise<void> {
    await (await this.engine.goals.get()).pause(sessionId)
    const live = this.engine.currentSession(sessionId)
    const active = await this.store.activeTurn(sessionId)
    const target = turnId ?? active?.id
    if (target) this.engine.cancelInstructionScan(target)
    if (!target) {
      const session = await this.store.getSession(sessionId)
      // Disconnect interrupts the turn before recovery starts. Stop must retire that recovery,
      // including a live provider that incorrectly reports reconnecting without an active turn.
      if (session?.runtimeState === 'reconnecting') {
        await this.engine.stopLive(sessionId)
        await this.store.expirePendingRequests(sessionId)
        await this.engine.record(sessionId, null, { type: 'session_state', state: 'stopped' })
        return
      }
      // A working session can have no active turn. Settle it so queued input can dispatch.
      if (!session || !['working', 'waiting', 'cancelling'].includes(session.runtimeState)) return
      await this.store.expirePendingRequests(sessionId)
      await this.engine.record(sessionId, null, { type: 'session_state', state: 'ready' })
      void this.engine.pump()
      return
    }
    if (!active || active.id !== target) {
      await this.store.cancelTurn(target)
      if (this.engine.currentSession(sessionId)?.admissionTurnId === target) await this.engine.stopLive(sessionId)
      void this.engine.pump()
      return
    }
    await this.engine.record(sessionId, target, { type: 'session_state', state: 'cancelling' })
    await this.store.expirePendingRequests(sessionId)
    if (live) await this.engine.withCurrentSessionHandle(live.generation, (handle) => handle.cancel())
    await this.store.cancelTurn(target)
  }

  /** Hands a queued turn to the running turn. See ManagedAgentEngine.steerTurn. */
  steerTurn(sessionId: string, turnId: string): Promise<AgentTurn> {
    return this.engine.steerTurn(sessionId, turnId)
  }

  async cancelSubagent(sessionId: string, subagentId: string): Promise<void> {
    const session = await this.store.requireSession(sessionId)
    if (!session.subagents.some((child) => child.id === subagentId))
      throw new Error('Subagent not found in this session.')
    if (session.archivedAt) throw new Error('This session is archived.')
    if (session.controller !== 'acorn') throw new Error('This session is controlled outside Acorn.')
    const cancelled = await this.engine.sessionHandleIfPresent(sessionId, async (handle) => {
      if (!handle.cancelSubagent) throw new Error('This harness does not support stopping individual subagents.')
      await handle.cancelSubagent(subagentId)
      return true
    })
    if (!cancelled) throw new Error('The subagent connection is unavailable.')
  }

  async patchQueuedTurn(
    sessionId: string,
    turnId: string,
    patch: { input?: AgentTurn['input']; ordinal?: number },
  ): Promise<AgentTurn> {
    if (patch.input) {
      const session = await this.store.requireSession(sessionId)
      const cwd = await this.core.tasks.requireRoot(session.taskId)
      await validateAgentInputFiles(cwd, patch.input)
    }
    return this.store.patchQueuedTurn(sessionId, turnId, patch)
  }

  async resolveRequest(
    sessionId: string,
    providerRequestId: string,
    resolution: unknown,
    idempotencyKey: string,
  ): Promise<AgentRequest> {
    assertBoundedJson('Agent request resolution', resolution, MAX_AGENT_RESOLUTION_BYTES)
    const existing = await this.store.request(sessionId, providerRequestId)
    if (!existing) {
      throw new Error('Agent request not found.')
    }
    if (existing.status === 'resolved' || existing.status === 'expired') return existing
    assertOfferedOption(existing, resolution)
    const claim = await this.store.claimRequestResolution(sessionId, providerRequestId, resolution, idempotencyKey)
    if (!claim.claimed) return claim.request
    const session = await this.store.requireSession(sessionId)
    try {
      // A bridge's ask is held here, not parked in the harness (holdAsk).
      const answerAsk = this.loopAsks.get(providerRequestId)
      if (answerAsk) answerAsk(resolution)
      else {
        const live = await this.engine.ensureSession(session)
        await this.engine.withSessionHandle(live, (handle) => handle.resolveRequest(providerRequestId, resolution))
      }
    } catch (error) {
      // The provider may have accepted the response before transport failure. Expire the durable
      // claim rather than making a second attempt that could grant a permission twice.
      await this.store.expireClaimedRequest(sessionId, providerRequestId)
      await this.engine.record(sessionId, existing.turnId, {
        type: 'diagnostic',
        level: 'warning',
        message: 'The provider did not acknowledge this response. Acorn will not resend it automatically.',
      })
      throw error
    }
    await this.engine.record(sessionId, existing.turnId, {
      type: 'request_resolved',
      requestId: providerRequestId,
      resolution,
    })
    const resolved = await this.store.request(sessionId, providerRequestId)
    if (!resolved) throw new Error('Resolved agent request was not persisted.')
    return resolved
  }

  async compact(sessionId: string): Promise<void> {
    const session = await this.store.requireSession(sessionId)
    const live = await this.engine.ensureSession(session)
    await this.engine.withSessionHandle(live, (handle) => {
      if (!handle.compact) throw new Error('This provider does not support native compaction.')
      return handle.compact()
    })
  }

  async patchSession(
    sessionId: string,
    patch: { title?: string; archived?: boolean; lastReadSeq?: number; config?: Record<string, unknown> },
    // `changedBy` names a plugin that changed an option, so the person can see who changed their model.
    options: { remember?: boolean; changedBy?: string } = {},
  ): Promise<AgentSession> {
    const before = await this.store.requireSession(sessionId)
    let persistedPatch = patch
    if (patch.config) {
      assertBoundedJson('Agent session configuration', patch.config, MAX_AGENT_CONFIG_BYTES)
      // General replacement changes provider options, but retains admitted authority and identity.
      // MCP selection has its own operation, which checks Settings and restarts the provider.
      persistedPatch = {
        ...patch,
        config: retainSessionAuthority(patch.config, before.config),
      }
      const previousOptions = Array.isArray(before.config.configOptions)
        ? (before.config.configOptions as Array<{ id?: unknown; currentValue?: unknown }>)
        : []
      const nextOptions = Array.isArray(patch.config.configOptions)
        ? (patch.config.configOptions as Array<{ id?: unknown; currentValue?: unknown }>)
        : []
      const changed = nextOptions.flatMap((option) => {
        if (typeof option.id !== 'string' || typeof option.currentValue !== 'string') return []
        const previous = previousOptions.find((candidate) => candidate.id === option.id)
        if (!previous) throw new Error(`Provider did not advertise configuration option '${option.id}'.`)
        const advertised = previous as {
          label?: unknown
          values?: Array<{ value?: unknown; label?: unknown }>
        }
        if (
          Array.isArray(advertised.values) &&
          !advertised.values.some((candidate) => candidate.value === option.currentValue)
        ) {
          throw new Error(`Provider did not advertise value '${option.currentValue}' for '${option.id}'.`)
        }
        if (previous.currentValue === option.currentValue) return []
        const chosen = advertised.values?.find((candidate) => candidate.value === option.currentValue)
        return [
          {
            id: option.id,
            value: option.currentValue,
            label: typeof advertised.label === 'string' ? advertised.label : option.id,
            valueLabel: typeof chosen?.label === 'string' ? chosen.label : option.currentValue,
          },
        ]
      })
      if (changed.length) {
        const live = await this.engine.ensureSession(before)
        for (const option of changed) {
          await this.engine.withCurrentSessionHandle(live, async (handle) => {
            await handle.setConfig?.(option.id, option.value)
          })
          // Record model and reasoning changes because they affect later turns.
          await this.engine.record(sessionId, null, {
            type: 'diagnostic',
            level: 'info',
            message: `${option.label} changed to ${option.valueLabel}${options.changedBy ? ` by ${options.changedBy}` : ''}`,
          })
        }
        // Both user and automation changes pass here before updating saved defaults.
        if (options.remember !== false) await this.sessionDefaults.remember(before.providerId, changed)
      }
      const latest = await this.store.requireSession(sessionId)
      persistedPatch = {
        ...persistedPatch,
        config: retainSessionAuthority(
          mergeSessionConfigChange(before.config, persistedPatch.config!, latest.config),
          latest.config,
        ),
      }
      assertBoundedJson('Agent session configuration', persistedPatch.config, MAX_AGENT_CONFIG_BYTES)
    }
    if (patch.archived != null) {
      const live = await this.engine.ensureSession(before).catch(() => null)
      if (live) {
        await this.engine
          .withCurrentSessionHandle(live, async (handle) => {
            await handle.archive?.(patch.archived!)
          })
          .catch(async (error) => {
            await this.engine.record(sessionId, null, {
              type: 'diagnostic',
              level: 'warning',
              message: `Local archive state changed, but the provider could not ${patch.archived ? 'archive' : 'unarchive'} its session: ${error instanceof Error ? error.message : 'unknown error'}`,
            })
          })
      }
      if (patch.archived) await this.engine.stopLive(sessionId)
    }
    const session = await this.store.patchSession(sessionId, persistedPatch)
    this.frames.emit({ channel: 'agent:session', session })
    return session
  }

  /** The session panel's view of MCP (docs/mcp.md § Your own servers). */
  async sessionMcp(sessionId: string): Promise<AgentSessionMcp> {
    const session = await this.store.requireSession(sessionId)
    const selected = new Set(sessionMcpSelection(session.config))
    const servers = (await this.mcpServers.list()).map((server) => ({
      name: server.name,
      transport: server.transport,
      enabled: selected.has(server.name),
    }))
    const reported = await this.engine.sessionHandleIfPresent(sessionId, async (handle) =>
      handle.mcpStatus ? handle.mcpStatus().catch(() => null) : null,
    )
    return { servers, reported, locked: await this.mcpLockedReason(session) }
  }

  /**
   * Switches this session's servers. A harness reads its servers only when its process starts, so a
   * running provider is stopped and started again, which resumes the same conversation with the new
   * list. That is why a turn in progress blocks the change.
   */
  async setSessionMcpServers(sessionId: string, enabled: readonly string[]): Promise<AgentSessionMcp> {
    const before = await this.store.requireSession(sessionId)
    const locked = await this.mcpLockedReason(before)
    if (locked) throw new Error(locked)
    const known = new Set((await this.mcpServers.list()).map((server) => server.name))
    const unknown = enabled.filter((name) => !known.has(name))
    // Worded for the bridge's status mapping: "not found" is a 404.
    if (unknown.length) throw new Error(`MCP server not found: ${unknown.join(', ')}.`)
    const previous = sessionMcpSelection(before.config)
    const next = [...new Set(enabled)].sort()
    const on = next.filter((name) => !previous.includes(name))
    const off = previous.filter((name) => !next.includes(name))
    if (!on.length && !off.length) return this.sessionMcp(sessionId)

    const latest = await this.store.requireSession(sessionId)
    const session = await this.store.patchSession(sessionId, { config: { ...latest.config, mcpServers: next } })
    this.frames.emit({ channel: 'agent:session', session })
    const changes = [...on.map((name) => `${name} on`), ...off.map((name) => `${name} off`)].join(', ')
    const live = this.engine.hasLiveSession(sessionId)
    await this.engine.record(sessionId, null, {
      type: 'diagnostic',
      level: 'info',
      message: live
        ? `MCP servers changed (${changes}). The agent restarted to pick them up.`
        : `MCP servers changed (${changes}). They apply from the next message.`,
    })
    if (live) {
      await this.engine.stopLive(sessionId)
      // Not awaited: a start can take as long as a session start does, and the panel polls. A start that
      // fails records its own error in the transcript, which is where the reader looks.
      void this.engine.ensureSession(session).catch(() => undefined)
    }
    return this.sessionMcp(sessionId)
  }

  // Each reason is also the error setSessionMcpServers() throws, so each is worded to land on the
  // bridge's 409 ("archived", "controlled", "active turn").
  private async mcpLockedReason(session: AgentSession): Promise<string | null> {
    if (session.runtimeState === 'archived') return 'This session is archived.'
    if (session.controller !== 'acorn')
      return 'This session is controlled by a terminal. Return it to acorn to change its servers.'
    if (await this.store.activeTurn(session.id)) return 'Finish or cancel the active turn to change servers.'
    return null
  }

  async fork(sessionId: string, title?: string): Promise<AgentSession> {
    const source = await this.store.requireSession(sessionId)
    const active = await this.store.activeTurn(sessionId)
    if (active) throw new Error('Finish or cancel the active turn before forking.')
    const live = await this.engine.ensureSession(source)
    const providerForkRef =
      (await this.engine.withCurrentSessionHandle(live, async (handle) => handle.fork?.())) ?? undefined
    const pendingForkContext = providerForkRef ? undefined : await this.engine.forkContext(source)
    return this.createSession({
      taskId: source.taskId,
      providerId: source.providerId,
      profileId: source.profileId,
      title: title ?? `${source.title} (fork)`,
      kind: 'interactive',
      resumeProviderSessionRef: providerForkRef,
      parentSessionId: source.id,
      config: {
        ...source.config,
        forkKind: providerForkRef ? 'provider-native' : 'acorn-context-copy',
        forkSourceSessionId: source.id,
        ...(pendingForkContext ? { pendingForkContext } : {}),
      },
    })
  }

  async deleteSession(sessionId: string): Promise<AgentDeleteResult> {
    const session = await this.store.requireSession(sessionId)
    await this.titleGeneration.cancel(sessionId)
    const live =
      this.engine.currentSession(sessionId)?.generation ??
      (session.providerSessionRef ? await this.engine.ensureSession(session).catch(() => null) : null)
    let provider: AgentDeleteResult['provider'] = 'unsupported'
    let detail: string | undefined
    if (live) {
      try {
        const deleted = await this.engine.withCurrentSessionHandle(live, async (handle) => {
          if (!handle.delete) return false
          await handle.delete()
          return true
        })
        if (deleted) provider = 'deleted'
      } catch (error) {
        provider = 'failed'
        detail = error instanceof Error ? error.message : 'Provider-side deletion failed.'
      }
    }
    await this.engine.stopLive(sessionId)
    const removed = await this.store.deleteSession(sessionId)
    this.engine.revokeSessionCredential(session)
    await Promise.all([
      this.attachments.collectNow(removed.attachmentIds),
      this.artifacts.collectRemoved(removed.artifactObjects),
      this.attachments.removeSessionFolder(sessionId),
    ])
    this.frames.emit({ channel: 'agent:deleted', sessionId })
    return { local: 'deleted', provider, ...(detail ? { detail } : {}) }
  }

  /**
   * Removes the stored history of the sessions of the tasks `taskIds` names, for the retention
   * schedule (docs/data-layer/backup-and-retention.md § Retention). The rows stay, each with `note` as
   * its transcript, so the task still lists them. Provider-side sessions are left alone: deleting one
   * would mean starting its CLI, and the node's disk is what this is for.
   *
   * SQLite is synchronous here and a first pass can have a million rows to delete, so each step is one
   * small transaction and the node gets a turn between steps. `taskIds` is asked again before each
   * step, and nothing yields between that answer and the write, so a task restored part-way through is
   * left alone from then on. A session with a provider process or a turn in flight is left for a
   * later pass. Stops early on the signal; the next run carries on where this one stopped.
   */
  async removeArchivedHistory(options: {
    taskIds: () => Promise<readonly string[]>
    note: string
    signal?: AbortSignal
    batch?: number
  }): Promise<{ sessions: number; events: number; complete: boolean }> {
    const batch = options.batch ?? HISTORY_BATCH
    const totals = { sessions: 0, events: 0, complete: false }
    while (!this.engine.isStopped && !options.signal?.aborted) {
      const taskIds = await options.taskIds()
      if (this.engine.isStopped || options.signal?.aborted) break
      const sessionId = this.store.sessionWithHistory(taskIds, new Set(this.engine.liveSessionIds()))
      if (!sessionId) {
        totals.complete = true
        break
      }
      const deleted = this.store.deleteOldestEvents(sessionId, batch)
      totals.events += deleted
      if (deleted < batch) {
        const finished = await this.store.finishHistoryRemoval(sessionId, options.note)
        if (finished) {
          totals.sessions += 1
          await Promise.all([
            this.attachments.collectNow(finished.attachmentIds),
            this.artifacts.collectRemoved(finished.artifactObjects),
            this.attachments.removeSessionFolder(sessionId),
          ])
          // For a window that has the session open: the note lands, and a reload reads only the note.
          this.frames.emit({ channel: 'agent:event', event: finished.event })
          this.frames.emit({ channel: 'agent:session', session: finished.session })
        }
      }
      await new Promise((resolve) => setImmediate(resolve))
    }
    // Each deleted event left a tombstone in the search index until a merge (mergeSearchIndex).
    if (totals.events && !this.engine.isStopped) await mergeSearchIndex(this.db, undefined, options.signal)
    return totals
  }

  /** Deletes everything this plugin holds for deleted tasks. Loaded on first use, to stay inside the
   *  service boot budget (apps/node/scripts/check-service-budget.mjs). */
  async purgeDeletedTasks(taskIds: readonly string[], signal?: AbortSignal): Promise<number> {
    const { purgeDeletedTasks } = await import('./deletedTaskPurge')
    return purgeDeletedTasks(
      {
        engine: this.engine,
        frames: this.frames,
        store: this.store,
        attachments: this.attachments,
        artifacts: this.artifacts,
        db: this.db,
        batch: HISTORY_BATCH,
        mergeSearchIndex,
      },
      taskIds,
      signal,
    )
  }

  async handoffToTerminal(sessionId: string): Promise<AgentSession> {
    if (await this.store.activeTurn(sessionId)) {
      throw new Error('Finish or cancel the active turn before continuing in the terminal.')
    }
    const before = await this.store.requireSession(sessionId)
    if (!before.providerSessionRef) throw new Error('The provider has not supplied a resumable session reference.')
    if (!this.startTerminalHandoff) throw new Error('Terminal handoff is unavailable.')
    await this.engine.stopLive(sessionId)
    await this.store.setController(sessionId, 'terminal')
    let terminalSessionId: string
    try {
      terminalSessionId = await this.startTerminalHandoff(before)
    } catch (error) {
      await this.store.setController(sessionId, 'acorn')
      throw error
    }
    await this.engine.record(sessionId, null, {
      type: 'session_state',
      state: 'stopped',
      detail: 'Input control was transferred to a terminal.',
    })
    await this.engine.record(sessionId, null, {
      type: 'terminal',
      terminalSessionId,
      title: `Continue ${before.providerId} in terminal`,
    })
    const session = await this.store.requireSession(sessionId)
    this.frames.emit({ channel: 'agent:session', session })
    return session
  }

  async resumeManaged(sessionId: string): Promise<AgentSession> {
    const before = await this.store.requireSession(sessionId)
    if (before.controller !== 'terminal') {
      throw new Error('Only a terminal-owned session can return through terminal handoff.')
    }
    if (await this.terminalHandoffRunning?.(sessionId)) {
      throw new Error('Exit the linked provider terminal before returning input control to Acorn.')
    }
    const current = await this.store.setController(sessionId, 'acorn')
    await this.engine.ensureSession(current)
    const session = await this.store.requireSession(sessionId)
    this.frames.emit({ channel: 'agent:session', session })
    return session
  }

  /** An export is publication: with blocking on, the exact serialized bytes pass the secret gate
   *  first. */
  async exportSession(
    sessionId: string,
    format: 'json' | 'markdown',
    variant: 'original' | 'redacted' = 'original',
  ): Promise<{ content: string; digest: string }> {
    const exported = await (await this.transcriptCommands()).export(sessionId, format, variant === 'redacted')
    if (this.core.secretPublication) {
      await (
        await import('./secretPublication')
      ).admitExport(this.core.secretPublication, { sessionId, format, variant, ...exported })
    }
    return exported
  }

  async captureExecution(sessionId: string, turnIds: readonly string[]): Promise<AgentSessionSnapshot> {
    // Join accepted buffered deltas, including cancellation paths with no terminal provider event.
    await this.engine.flushProviderEvents(sessionId)
    return this.store.executionSnapshot(sessionId, turnIds)
  }

  async wait(
    sessionId: string,
    afterSeq: number,
    until: WaitCondition,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentSessionSnapshot> {
    return waitForSessionSnapshot(
      {
        store: this.store,
        subscribe: (listener) => this.frames.subscribe(listener),
        shutdown: this.engine.shutdownSignal,
      },
      sessionId,
      afterSeq,
      until,
      timeoutMs,
      signal,
    )
  }
}
export type { AgentRuntimeOptions }
