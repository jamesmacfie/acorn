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
import { mergeSessionConfigChange } from './sessionConfigMerge'
import { SessionTitleGeneration } from './sessionTitleGeneration'
import { SessionDefaultsCommands } from './sessionDefaultsCommands'
import { TranscriptCommands } from './transcriptCommands'
import { waitForSessionSnapshot } from './sessionWait'

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

  private async reserveSession(
    input: CreateAgentSessionInput,
    idempotencyKey?: string,
  ): Promise<{ session: AgentSession; created: boolean }> {
    assertBoundedJson('Agent session configuration', input.config, MAX_AGENT_CONFIG_BYTES)
    if (idempotencyKey) {
      const existing = await this.store.operationResult<AgentSession>(idempotencyKey, 'session.create')
      if (existing) return { session: await this.store.requireSession(existing.id), created: false }
    }
    const provider = (await this.providers()).find((candidate) => candidate.id === input.providerId)
    if (!provider) throw new Error(`Managed provider is not registered: ${input.providerId}`)
    if (!provider.installed) throw new Error(provider.diagnostics[0] ?? `${provider.label} is unavailable.`)
    if (provider.authenticated === false) {
      throw new Error(`${provider.label} is installed but its CLI account is not authenticated.`)
    }
    if (input.profileId !== provider.profileId) {
      throw new Error(`Provider '${provider.id}' requires profile '${provider.profileId}'.`)
    }
    await this.core.tasks.requireRoot(input.taskId)
    const session = await this.store.createSession(input, provider)
    if (idempotencyKey) await this.store.saveOperation(idempotencyKey, 'session.create', session, session.id)
    return { session, created: true }
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
      await this.ensureSession(session)
      // Workflow steps set their own options. Forks continue their source session's options.
      if (session.kind === 'interactive' && !session.parentSessionId) {
        await this.sessionDefaults.applySaved(session.id, session.providerId).catch(async (error) => {
          await this.record(session.id, null, {
            type: 'diagnostic',
            level: 'warning',
            message: `Your saved defaults could not be read for this session: ${error instanceof Error ? error.message : 'unknown error'}`,
          })
        })
      }
      if (session.kind === 'delegated') {
        const requested = session.config.requestedConfigOptions
        if (requested && typeof requested === 'object' && !Array.isArray(requested)) {
          const values = Object.fromEntries(Object.entries(requested).filter((entry): entry is [string, string] =>
            typeof entry[1] === 'string'))
          await this.applyRequestedConfig(session.id, values)
        }
      }
      await this.completeSessionReadiness(session.id)
      return this.store.requireSession(session.id)
    } catch (error) {
      this.discardSessionReadinessHold(session.id)
      throw error
    }
  }

  override async stop(): Promise<void> {
    await this.titleGeneration.stop()
    await super.stop()
    // Provider starts can outlive HTTP requests. Join initialization before closing the database.
    await Promise.allSettled(this.sessionInitializations.values())
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
    if (session.runtimeState === 'failed' || session.runtimeState === 'stopped') {
      await this.stopLive(session.id)
    }
    // Acceptance ends at the durable write. A startup failure is recorded against the queued turn.
    void this.ensureSession(session)
      .then(() => this.pump())
      .catch(() => undefined)
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

  /** Regenerates the title from the first durable text prompt. */
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
      // toolCeiling is authorization state written when the session is created. The general config
      // patch route may update provider options, but it may neither add, widen, nor remove that field.
      const clientConfig = { ...patch.config }
      delete clientConfig.toolCeiling
      persistedPatch = {
        ...patch,
        config: {
          ...clientConfig,
          ...(Object.prototype.hasOwnProperty.call(before.config, 'toolCeiling')
            ? { toolCeiling: before.config.toolCeiling }
            : {}),
        },
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
        config: mergeSessionConfigChange(before.config, persistedPatch.config!, latest.config),
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

  async wait(
    sessionId: string,
    afterSeq: number,
    until: WaitCondition,
    timeoutMs: number,
  ): Promise<AgentSessionSnapshot> {
    return waitForSessionSnapshot({
      store: this.store,
      conditionMet: (snapshot, condition) => this.conditionMet(snapshot, condition),
      subscribe: (listener) => this.subscribe(listener),
    }, sessionId, afterSeq, until, timeoutMs)
  }
}
export type { AgentRuntimeOptions }
