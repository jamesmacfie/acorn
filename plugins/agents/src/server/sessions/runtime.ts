import type {
  AgentDeleteResult,
  AgentRequest,
  AgentSession,
  AgentSessionSnapshot,
  AgentTurn,
} from '../../contract/wire.ts'
import type { CreateAgentSessionInput, EnqueueAgentTurnInput } from '../../shared/schemas'
import {
  assertBoundedJson,
  MAX_AGENT_CONFIG_BYTES,
  MAX_AGENT_POLICY_BYTES,
  MAX_AGENT_RESOLUTION_BYTES,
  validateAgentInputFiles,
} from './inputValidation'
import {
  ManagedAgentEngine,
  type AgentRuntimeOptions,
  type WaitCondition,
} from './runtimeEngine'
import { mergeSessionConfigChange, retainSessionAuthority } from './sessionConfigMerge'
import { sessionMcpSelection, type AgentSessionMcp } from '../../shared/mcpServers'
import { customAgentRegistry, readCustomAgents } from '../customAgents'
import { customAgentSnapshot, sessionCustomAgent, type CustomAgent } from '../../shared/customAgents'
import { delegatedToolCeiling } from '../delegation/policy'
import { parseToolCeiling } from '@acorn/protocol/toolPolicy.ts'
import { SessionTitleGeneration } from './sessionTitleGeneration'
import { SessionDefaultsCommands } from './sessionDefaultsCommands'
import { TranscriptCommands } from './transcriptCommands'
import { waitForSessionSnapshot } from './sessionWait'
import { CODEX_PLAN_IMPLEMENTATION_PROMPT } from '../../shared/codexPlanHandoff'
import { mergeSearchIndex } from './ledgerCompaction'

// Events deleted per step by removeArchivedHistory. Each is a row and its search row. On 20,000
// synthetic tool rows of about 2 KB, a step of 200 held the node for a median of 7 ms and 18 ms at the
// 95th percentile, about 22,000 rows a second. A step of 500 doubled the median for little gain.
const HISTORY_BATCH = 200

/**
 * Replaces the first text part with the hook's single result and keeps every non-text part.
 * The hook receives joined text, so retaining later text parts would repeat the prompt.
 */
const withPromptText = (parts: EnqueueAgentTurnInput['input'], text: string): EnqueueAgentTurnInput['input'] => {
  let used = false
  const next: EnqueueAgentTurnInput['input'] = []
  for (const part of parts) {
    if (part.type !== 'text') next.push(part)
    else if (!used) {
      used = true
      next.push({ ...part, text })
    }
  }
  return next
}

/**
 * A button answer must be one the stored request offered. The client builds its buttons from that
 * same list, so only a forged or stale answer fails here, and it fails before the claim: the request
 * stays open and nothing reaches the provider. A request that offered no buttons is left alone.
 */
const assertOfferedOption = (request: AgentRequest, resolution: unknown): void => {
  const optionId = typeof resolution === 'object' && resolution != null
    ? (resolution as { optionId?: unknown }).optionId
    : undefined
  if (typeof optionId !== 'string') return
  const offered = Array.isArray(request.payload.options) ? request.payload.options as Array<{ id?: unknown }> : []
  if (offered.length && !offered.some((option) => option?.id === optionId)) {
    throw new Error('That choice was not offered for this request.')
  }
}

/**
 * Product-facing managed-agent commands. ManagedAgentEngine owns process supervision, event
 * durability, and scheduling. This class coordinates session lifecycle and user commands.
 */
export class ManagedAgentRuntime extends ManagedAgentEngine {
  private readonly sessionInitializations = new Map<string, Promise<AgentSession>>()
  private readonly titleGeneration = new SessionTitleGeneration({
    store: this.store,
    models: this.core.models,
    currentUserId: this.currentUserId,
    publish: (session) => this.emit({ channel: 'agent:session', session }),
    telemetry: this.telemetry,
  })
  private readonly sessionDefaults = new SessionDefaultsCommands({
    store: this.store,
    prefs: this.core.prefs,
    currentUserId: this.currentUserId,
    patchSession: (sessionId, patch, options) => this.patchSession(sessionId, patch, options),
    recordWarning: async (sessionId, message) => {
      await this.record(sessionId, null, { type: 'diagnostic', level: 'warning', message })
    },
  })
  private readonly transcripts = new TranscriptCommands({
    store: this.store,
    providers: () => this.providers(),
    requireTaskRoot: (taskId) => this.core.tasks.requireRoot(taskId),
    record: async (sessionId, turnId, event) => { await this.record(sessionId, turnId, event) },
    ensureSession: async (session) => { await this.ensureSession(session) },
    publish: (session) => this.emit({ channel: 'agent:session', session }),
  })

  async createSession(
    input: CreateAgentSessionInput,
    idempotencyKey?: string,
  ): Promise<AgentSession> {
    const reserved = await this.reserveSession(input, idempotencyKey)
    return reserved.created
      ? this.startCreatedSession(reserved.session)
      : reserved.session
  }

  /**
   * Interactive HTTP creation is acknowledged once the row is durable. The provider handshake keeps
   * running under runtime ownership and publishes its lifecycle over the existing agent WebSocket.
   * Internal workflow callers keep using createSession(), whose ready-on-return contract is unchanged.
   */
  async acceptSession(
    input: CreateAgentSessionInput,
    idempotencyKey?: string,
  ): Promise<AgentSession> {
    if (input.kind !== 'interactive' && input.kind !== 'delegated') return this.createSession(input, idempotencyKey)
    const reserved = await this.reserveSession(input, idempotencyKey)
    if (reserved.created) void this.startCreatedSession(reserved.session).catch(() => undefined)
    return reserved.session
  }

  private readonly reservations = new Set<Promise<{ session: AgentSession; created: boolean }>>()

  private reserveSession(
    input: CreateAgentSessionInput,
    idempotencyKey?: string,
  ): Promise<{ session: AgentSession; created: boolean }> {
    const reservation = Promise.resolve().then(() => this.reserveSessionWave(input, idempotencyKey))
    this.reservations.add(reservation)
    const settled = () => this.reservations.delete(reservation)
    void reservation.then(settled, settled)
    return reservation
  }

  private async reserveSessionWave(
    input: CreateAgentSessionInput,
    idempotencyKey?: string,
  ): Promise<{ session: AgentSession; created: boolean }> {
    this.shutdown.signal.throwIfAborted()
    assertBoundedJson('Agent session configuration', input.config, MAX_AGENT_CONFIG_BYTES)
    if (idempotencyKey) {
      const existing = await this.readWhileRunning(() => this.store.operationResult<AgentSession>(idempotencyKey, 'session.create'))
      if (existing) return { session: await this.readWhileRunning(() => this.store.requireSession(existing.id)), created: false }
    }
    const provider = await this.readWhileRunning(() => this.usableProvider((candidate) => candidate.id === input.providerId))
    if (!provider) throw new Error(`Managed provider is not registered: ${input.providerId}`)
    if (!provider.installed) throw new Error(provider.diagnostics[0] ?? `${provider.label} is unavailable.`)
    if (provider.authenticated === false) {
      throw new Error(`${provider.label} is installed but its CLI account is not authenticated.`)
    }
    if (input.profileId !== provider.profileId) {
      throw new Error(`Provider '${provider.id}' requires profile '${provider.profileId}'.`)
    }
    await this.readWhileRunning(() => this.core.tasks.requireRoot(input.taskId))
    // The servers switched on in Settings, decided here rather than taken from the caller: which
    // programs a session starts is the owner's setting, not something a request body can widen.
    const withAgent = await this.readWhileRunning(() => this.withCustomAgent(input))
    const mcpServers = await this.readWhileRunning(() => this.mcpServers.enabledNames())
    this.shutdown.signal.throwIfAborted()
    const session = await this.store.createSession({ ...withAgent, config: { ...withAgent.config, mcpServers } }, provider)
    if (idempotencyKey) await this.store.saveOperation(idempotencyKey, 'session.create', session, session.id)
    return { session, created: true }
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
   * client's own `customAgent` is dropped (../routes/managed.ts).
   */
  private async withCustomAgent(input: CreateAgentSessionInput): Promise<CreateAgentSessionInput> {
    if (!input.customAgentId) return input
    const config = input.config
    const agent = (await this.customAgents()).find((candidate) => candidate.id === input.customAgentId)
    if (!agent) throw new Error('That custom agent no longer exists.')
    if (agent.providerId !== input.providerId) {
      throw new Error(`${agent.name} runs on '${agent.providerId}', not '${input.providerId}'.`)
    }
    const requested = typeof config.requestedConfigOptions === 'object' && config.requestedConfigOptions
      ? config.requestedConfigOptions as Record<string, unknown>
      : {}
    const agentCeiling = agent.maxToolRisk ? { maxRisk: agent.maxToolRisk } : undefined
    // An unreadable ceiling the caller sent removes every tool, the same as a corrupt persisted one.
    const ceiling = config.toolCeiling === undefined
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
    this.holdSessionReadiness(session.id)
    try {
      const live = await this.ensureSession(session)
      const signal = live.controller.signal
      // Workflow steps and sessions with an origin set their own options. Forks retain theirs.
      if (session.kind === 'interactive' && !session.parentSessionId && !session.origin) {
        await this.sessionDefaults.applySaved(session.id, session.providerId, signal).catch(async (error) => {
          signal.throwIfAborted()
          await this.record(session.id, null, {
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
          const values = Object.fromEntries(Object.entries(requested).filter((entry): entry is [string, string] =>
            typeof entry[1] === 'string'))
          await this.sessionDefaults.applyRequested(session.id, values, signal)
        }
      }
      signal.throwIfAborted()
      await this.completeSessionReadiness(session.id)
      return this.store.requireSession(session.id)
    } catch (error) {
      this.discardSessionReadinessHold(session.id)
      throw error
    }
  }

  private runtimeStop: Promise<void> | null = null

  override stop(): Promise<void> {
    if (this.runtimeStop) return this.runtimeStop
    // Retire startup immediately, while title generation drains its own work.
    const engine = super.stop()
    return this.runtimeStop = (async () => {
      await Promise.all([this.titleGeneration.stop(), engine])
      await Promise.allSettled([...this.reservations, ...this.sessionInitializations.values()])
    })()
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
    return this.transcripts.import(input)
  }

  async verifyImportedResume(sessionId: string): Promise<AgentSession> {
    return this.transcripts.verifyResume(sessionId)
  }

  async enqueueTurn(sessionId: string, input: EnqueueAgentTurnInput): Promise<AgentTurn> {
    const session = await this.store.requireSession(sessionId)
    if (session.controller !== 'acorn') throw new Error(`Session input is controlled by ${session.controller}.`)
    if (session.archivedAt) throw new Error('Archived sessions cannot accept turns.')
    const cwd = await this.core.tasks.requireRoot(session.taskId)
    await validateAgentInputFiles(cwd, input.input)
    assertBoundedJson('Effective agent policy', input.effectivePolicy, MAX_AGENT_POLICY_BYTES)
    // Every accepted turn passes this hook. Offer text only; attachments and policy remain with the owner.
    const prompt = await this.hooks?.run('before-send', {
      sessionId,
      taskId: session.taskId,
      text: input.input.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n'),
    })
    if (prompt && !prompt.ok) throw new Error(`${prompt.by}: ${prompt.reason}`)
    const enqueued = prompt && prompt.payload.text !== undefined
      ? { ...input, input: withPromptText(input.input, prompt.payload.text) }
      : input
    const advertisedOptions = Array.isArray(session.config.configOptions)
      ? session.config.configOptions as Array<{
          id?: unknown
          label?: unknown
          category?: unknown
          currentValue?: unknown
        }>
      : []
    const providerPolicy = advertisedOptions.flatMap((option) =>
      typeof option.id === 'string'
        && typeof option.category === 'string'
        && ['permission', 'mode', 'model', 'reasoning'].includes(option.category)
        ? [{
            id: option.id,
            label: typeof option.label === 'string' ? option.label : option.id,
            category: option.category,
            value: typeof option.currentValue === 'string' ? option.currentValue : null,
          }]
        : [])
    const outcome = await this.store.enqueueTurn(sessionId, {
      ...enqueued,
      effectivePolicy: {
        ...enqueued.effectivePolicy,
        providerAdvertisedPolicy: providerPolicy,
        providerStatusAuthority: session.statusAuthority,
        capturedAt: Date.now(),
      },
    })
    const { turn } = outcome
    // An idle session behind the concurrency limit emits no provider event, so publish its queue count.
    this.emit({ channel: 'agent:session', session: await this.store.requireSession(sessionId) })
    // The pump owns startup and admission after the durable acceptance boundary.
    void this.pump().catch(() => undefined)
    if (
      outcome.inserted
      && turn.ordinal === 0
      && turn.source === 'interactive'
      && outcome.firstTurnFallback
    ) {
      this.titleGeneration.start(session, enqueued.input, outcome.firstTurnFallback)
    }
    return turn
  }

  async implementCodexPlan(sessionId: string, itemId: string): Promise<AgentTurn> {
    const session = await this.store.requireSession(sessionId)
    if (session.controller !== 'acorn' || session.kind !== 'interactive'
      || session.driverKind !== 'codex-app-server' || session.archivedAt) {
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
    const { turn, inserted } = await this.store.acceptCodexPlan(sessionId, itemId, prompt)
    if (inserted) {
      const updated = await this.store.requireSession(sessionId)
      this.emit({ channel: 'agent:session', session: updated })
      this.emit({ channel: 'agent:turn', turn })
      void this.pump().catch(() => undefined)
    }
    return turn
  }

  /** Regenerate the title from the first durable text prompt. */
  async regenerateTitle(sessionId: string): Promise<AgentSession> {
    return this.titleGeneration.regenerate(sessionId)
  }

  // A raised concurrency limit must wake the pump without waiting for another turn or completion.
  drainQueue(): void {
    void this.pump()
  }

  async cancelTurn(sessionId: string, turnId?: string): Promise<void> {
    const live = this.live.get(sessionId)
    const active = await this.store.activeTurn(sessionId)
    const target = turnId ?? active?.id
    if (!target) {
      // A working session can have no active turn. Settle it so queued input can dispatch.
      const session = await this.store.getSession(sessionId)
      if (!session || !['working', 'waiting', 'cancelling'].includes(session.runtimeState)) return
      await this.store.expirePendingRequests(sessionId)
      await this.record(sessionId, null, { type: 'session_state', state: 'ready' })
      void this.pump()
      return
    }
    if (!active || active.id !== target) {
      await this.store.cancelTurn(target)
      if (this.live.get(sessionId)?.admissionTurnId === target) await this.stopLive(sessionId)
      void this.pump()
      return
    }
    await this.record(sessionId, target, { type: 'session_state', state: 'cancelling' })
    await this.store.expirePendingRequests(sessionId)
    await live?.handle?.cancel()
    await this.store.cancelTurn(target)
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
    const claim = await this.store.claimRequestResolution(
      sessionId,
      providerRequestId,
      resolution,
      idempotencyKey,
    )
    if (!claim.claimed) return claim.request
    const session = await this.store.requireSession(sessionId)
    try {
      const live = await this.ensureSession(session)
      if (!live.handle) throw new Error('Provider session is not connected.')
      await live.handle.resolveRequest(providerRequestId, resolution)
    } catch (error) {
      // The provider may have accepted the response before transport failure. Expire the durable
      // claim rather than making a second attempt that could grant a permission twice.
      await this.store.expireClaimedRequest(sessionId, providerRequestId)
      await this.record(sessionId, existing.turnId, {
        type: 'diagnostic',
        level: 'warning',
        message: 'The provider did not acknowledge this response. Acorn will not resend it automatically.',
      })
      throw error
    }
    await this.record(sessionId, existing.turnId, {
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
    const live = await this.ensureSession(session)
    if (!live.handle?.compact) throw new Error('This provider does not support native compaction.')
    await live.handle.compact()
  }

  async patchSession(
    sessionId: string,
    patch: { title?: string; archived?: boolean; lastReadSeq?: number; config?: Record<string, unknown> },
    options: { remember?: boolean } = {},
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
        ? before.config.configOptions as Array<{ id?: unknown; currentValue?: unknown }>
        : []
      const nextOptions = Array.isArray(patch.config.configOptions)
        ? patch.config.configOptions as Array<{ id?: unknown; currentValue?: unknown }>
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
          Array.isArray(advertised.values)
          && !advertised.values.some((candidate) => candidate.value === option.currentValue)
        ) {
          throw new Error(`Provider did not advertise value '${option.currentValue}' for '${option.id}'.`)
        }
        if (previous.currentValue === option.currentValue) return []
        const chosen = advertised.values?.find((candidate) => candidate.value === option.currentValue)
        return [{
          id: option.id,
          value: option.currentValue,
          label: typeof advertised.label === 'string' ? advertised.label : option.id,
          valueLabel: typeof chosen?.label === 'string' ? chosen.label : option.currentValue,
        }]
      })
      if (changed.length) {
        const live = await this.ensureSession(before)
        for (const option of changed) {
          await live.handle?.setConfig?.(option.id, option.value)
          // Record model and reasoning changes because they affect later turns.
          await this.record(sessionId, null, {
            type: 'diagnostic',
            level: 'info',
            message: `${option.label} changed to ${option.valueLabel}`,
          })
        }
        // Both user and automation changes pass here before updating saved defaults.
        if (options.remember !== false) await this.sessionDefaults.remember(before.providerId, changed)
      }
      const latest = await this.store.requireSession(sessionId)
      persistedPatch = {
        ...persistedPatch,
        config: retainSessionAuthority(
          mergeSessionConfigChange(before.config, persistedPatch.config!, latest.config), latest.config,
        ),
      }
      assertBoundedJson('Agent session configuration', persistedPatch.config, MAX_AGENT_CONFIG_BYTES)
    }
    if (patch.archived != null) {
      const live = await this.ensureSession(before).catch(() => null)
      if (live?.handle?.archive) {
        await live.handle.archive(patch.archived).catch(async (error) => {
          await this.record(sessionId, null, {
            type: 'diagnostic',
            level: 'warning',
            message: `Local archive state changed, but the provider could not ${patch.archived ? 'archive' : 'unarchive'} its session: ${error instanceof Error ? error.message : 'unknown error'}`,
          })
        })
      }
      if (patch.archived) await this.stopLive(sessionId)
    }
    const session = await this.store.patchSession(sessionId, persistedPatch)
    this.emit({ channel: 'agent:session', session })
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
    const handle = this.live.get(sessionId)?.handle
    const reported = handle?.mcpStatus ? await handle.mcpStatus().catch(() => null) : null
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
    // Worded for the bridge's status mapping (../routes/managedBridge.ts): "not found" is a 404.
    if (unknown.length) throw new Error(`MCP server not found: ${unknown.join(', ')}.`)
    const previous = sessionMcpSelection(before.config)
    const next = [...new Set(enabled)].sort()
    const on = next.filter((name) => !previous.includes(name))
    const off = previous.filter((name) => !next.includes(name))
    if (!on.length && !off.length) return this.sessionMcp(sessionId)

    const latest = await this.store.requireSession(sessionId)
    const session = await this.store.patchSession(sessionId, { config: { ...latest.config, mcpServers: next } })
    this.emit({ channel: 'agent:session', session })
    const changes = [...on.map((name) => `${name} on`), ...off.map((name) => `${name} off`)].join(', ')
    const live = this.live.has(sessionId)
    await this.record(sessionId, null, {
      type: 'diagnostic',
      level: 'info',
      message: live
        ? `MCP servers changed (${changes}). The agent restarted to pick them up.`
        : `MCP servers changed (${changes}). They apply from the next message.`,
    })
    if (live) {
      await this.stopLive(sessionId)
      // Not awaited: a start can take as long as a session start does, and the panel polls. A start that
      // fails records its own error in the transcript, which is where the reader looks.
      void this.ensureSession(session).catch(() => undefined)
    }
    return this.sessionMcp(sessionId)
  }

  // Each reason is also the error setSessionMcpServers() throws, so each is worded to land on the
  // bridge's 409 ("archived", "controlled", "active turn").
  private async mcpLockedReason(session: AgentSession): Promise<string | null> {
    if (session.runtimeState === 'archived') return 'This session is archived.'
    if (session.controller !== 'acorn') return 'This session is controlled by a terminal. Return it to acorn to change its servers.'
    if (await this.store.activeTurn(session.id)) return 'Finish or cancel the active turn to change servers.'
    return null
  }

  async fork(sessionId: string, title?: string): Promise<AgentSession> {
    const source = await this.store.requireSession(sessionId)
    const active = await this.store.activeTurn(sessionId)
    if (active) throw new Error('Finish or cancel the active turn before forking.')
    const live = await this.ensureSession(source)
    const providerForkRef = await live.handle?.fork?.()
    const pendingForkContext = providerForkRef ? undefined : await this.forkContext(source)
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

  async archive(sessionId: string, archived: boolean): Promise<AgentSession> {
    return this.patchSession(sessionId, { archived })
  }

  async deleteSession(sessionId: string): Promise<AgentDeleteResult> {
    const session = await this.store.requireSession(sessionId)
    await this.titleGeneration.cancel(sessionId)
    const live = this.live.get(sessionId)
      ?? (session.providerSessionRef ? await this.ensureSession(session).catch(() => null) : null)
    let provider: AgentDeleteResult['provider'] = 'unsupported'
    let detail: string | undefined
    if (live?.handle?.delete) {
      try {
        await live.handle.delete()
        provider = 'deleted'
      } catch (error) {
        provider = 'failed'
        detail = error instanceof Error ? error.message : 'Provider-side deletion failed.'
      }
    }
    await this.stopLive(sessionId)
    const removed = await this.store.deleteSession(sessionId)
    await Promise.all([
      this.attachments.collectNow(removed.attachmentIds),
      this.artifacts.collectRemoved(removed.artifactObjects),
    ])
    this.emit({ channel: 'agent:deleted', sessionId })
    return { local: 'deleted', provider, ...(detail ? { detail } : {}) }
  }

  /**
   * Removes the stored history of the sessions of the tasks `taskIds` names, for the retention
   * schedule (docs/data-layer.md § Retention). The rows stay, each with `note` as its transcript, so
   * the task still lists them. Provider-side sessions are left alone: deleting one would mean
   * starting its CLI, and the node's disk is what this is for.
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
    while (!this.stopped && !options.signal?.aborted) {
      const taskIds = await options.taskIds()
      if (this.stopped || options.signal?.aborted) break
      const sessionId = this.store.sessionWithHistory(taskIds, new Set(this.live.keys()))
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
          ])
          // For a window that has the session open: the note lands, and a reload reads only the note.
          this.emit({ channel: 'agent:event', event: finished.event })
          this.emit({ channel: 'agent:session', session: finished.session })
        }
      }
      await new Promise((resolve) => setImmediate(resolve))
    }
    // Each deleted event left a tombstone in the search index (./ledgerCompaction.ts says what merging
    // gets back).
    if (totals.events && !this.stopped) await mergeSearchIndex(this.db, undefined, options.signal)
    return totals
  }

  async handoffToTerminal(sessionId: string): Promise<AgentSession> {
    if (await this.store.activeTurn(sessionId)) {
      throw new Error('Finish or cancel the active turn before continuing in the terminal.')
    }
    const before = await this.store.requireSession(sessionId)
    if (!before.providerSessionRef) throw new Error('The provider has not supplied a resumable session reference.')
    if (!this.startTerminalHandoff) throw new Error('Terminal handoff is unavailable.')
    await this.stopLive(sessionId)
    await this.store.setController(sessionId, 'terminal')
    let terminalSessionId: string
    try {
      terminalSessionId = await this.startTerminalHandoff(before)
    } catch (error) {
      await this.store.setController(sessionId, 'acorn')
      throw error
    }
    await this.record(sessionId, null, {
      type: 'session_state',
      state: 'stopped',
      detail: 'Input control was transferred to a terminal.',
    })
    await this.record(sessionId, null, {
      type: 'terminal',
      terminalSessionId,
      title: `Continue ${before.providerId} in terminal`,
    })
    const session = await this.store.requireSession(sessionId)
    this.emit({ channel: 'agent:session', session })
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
    await this.ensureSession(current)
    const session = await this.store.requireSession(sessionId)
    this.emit({ channel: 'agent:session', session })
    return session
  }

  async exportSession(sessionId: string, format: 'json' | 'markdown'): Promise<string> {
    return this.transcripts.export(sessionId, format)
  }

  async captureExecution(sessionId: string, turnIds: readonly string[]): Promise<AgentSessionSnapshot> {
    // Join accepted buffered deltas, including cancellation paths with no terminal provider event.
    await this.providerEvents.flush(sessionId)
    return this.store.executionSnapshot(sessionId, turnIds)
  }

  async wait(
    sessionId: string,
    afterSeq: number,
    until: WaitCondition,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentSessionSnapshot> {
    return waitForSessionSnapshot({
      store: this.store,
      subscribe: (listener) => this.subscribe(listener),
      shutdown: this.shutdown.signal,
    }, sessionId, afterSeq, until, timeoutMs, signal)
  }
}
export type { AgentRuntimeOptions }
