import { randomUUID } from 'node:crypto'
import type {
  AgentConfigOption,
  AgentDeleteResult,
  AgentRequest,
  AgentSession,
  AgentSessionSnapshot,
  AgentTurn,
} from '@acorn/protocol/managedAgents.ts'
import type { CreateAgentSessionInput, EnqueueAgentTurnInput } from '../shared/schemas'
import {
  assertBoundedJson,
  MAX_AGENT_CONFIG_BYTES,
  MAX_AGENT_POLICY_BYTES,
  MAX_AGENT_RESOLUTION_BYTES,
  validateAgentInputFiles,
} from './inputValidation'
import { parseAgentTranscript } from './transcriptImport'
import { readAgentSessionDefaults, writeAgentSessionDefaults } from './sessionDefaultsStore'
import {
  effectiveAgentDefaults,
  optionsWithDefaults,
  rememberAgentDefaults,
} from '../shared/sessionDefaults'
import {
  agentTurnInputText,
  ManagedAgentEngine,
  type AgentRuntimeOptions,
  type WaitCondition,
} from './runtimeEngine'

/**
 * Product-facing managed-agent commands. Provider process supervision, ordered event durability,
 * and scheduling live in ManagedAgentEngine; this class owns lifecycle policy and user commands.
 */
/**
 * The turn's input with its text replaced by what the `before-send` chain left.
 *
 * The first text part carries the whole rewritten prompt and the rest are dropped, because the chain
 * saw one string and returned one string: putting it back into several parts would mean inventing a
 * split the handler never described. Every non-text part — attachments, file references, captured
 * context — is preserved in place, since none of it was offered to the chain.
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

export class ManagedAgentRuntime extends ManagedAgentEngine {
  private readonly sessionInitializations = new Map<string, Promise<AgentSession>>()

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
    if (input.kind !== 'interactive') return this.createSession(input, idempotencyKey)
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
    if (!(await this.core.tasks.root(input.taskId, this.currentUserId()))) {
      throw new Error('The task has no mapped checkout.')
    }
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
      // Interactive sessions only, and not a fork. A workflow step names the model it wants in its own
      // policy, and a fork continues the session it came from, so neither is the owner opening something
      // new for the defaults to answer for.
      if (session.kind === 'interactive' && !session.parentSessionId) {
        await this.applySessionDefaults(session.id, session.providerId).catch(async (error) => {
          await this.record(session.id, null, {
            type: 'diagnostic',
            level: 'warning',
            message: `Your saved defaults could not be read for this session: ${error instanceof Error ? error.message : 'unknown error'}`,
          })
        })
      }
      await this.completeSessionReadiness(session.id)
      return this.store.requireSession(session.id)
    } catch (error) {
      this.discardSessionReadinessHold(session.id)
      throw error
    }
  }

  override async stop(): Promise<void> {
    await super.stop()
    // Provider start is now allowed to outlive its HTTP request, but never the plugin database it may
    // still update. super.stop() stops/awaits each live start; this joins the policy continuation too.
    await Promise.allSettled(this.sessionInitializations.values())
  }

  /**
   * Fold the owner's stored defaults onto what the provider advertised while starting. It runs after
   * the driver's `session_metadata` rather than at insert, because the advertised option list is
   * where the values are validated and there is nothing to validate against until the provider has
   * reported it. A refusal is recorded and dropped: a default that cannot be applied is not a reason
   * to fail the session the owner just opened.
   */
  private async applySessionDefaults(sessionId: string, providerId: string): Promise<void> {
    const userId = this.currentUserId()
    if (!userId) return
    const stored = await readAgentSessionDefaults(this.core.prefs, userId)
    const wanted = effectiveAgentDefaults(stored, providerId)
    if (!Object.keys(wanted).length) return
    const session = await this.store.requireSession(sessionId)
    const advertised = Array.isArray(session.config.configOptions)
      ? session.config.configOptions as AgentConfigOption[]
      : []
    const configOptions = optionsWithDefaults(advertised, wanted)
    if (configOptions === advertised) return
    // `remember: false`, or applying the stored value would write it straight back.
    await this.patchSession(sessionId, { config: { ...session.config, configOptions } }, { remember: false })
      .catch(async (error) => {
        await this.record(sessionId, null, {
          type: 'diagnostic',
          level: 'warning',
          message: `Your saved defaults could not be applied to this session: ${error instanceof Error ? error.message : 'unknown error'}`,
        })
      })
  }

  /** Carry an in-session switch forward, so the next session of this provider starts where this one is. */
  private async rememberSessionDefaults(
    providerId: string,
    changed: ReadonlyArray<{ id: string; value: string }>,
  ): Promise<void> {
    const userId = this.currentUserId()
    if (!userId) return
    const stored = await readAgentSessionDefaults(this.core.prefs, userId)
    if (!stored.followLastSession) return
    const chosen = Object.fromEntries(changed.map((option) => [option.id, option.value]))
    await writeAgentSessionDefaults(
      this.core.prefs,
      userId,
      rememberAgentDefaults(stored, providerId, chosen),
    )
  }

  async importTranscript(input: {
    taskId: string
    providerId: string
    profileId: string
    title?: string
    content: string
  }): Promise<AgentSession> {
    const provider = (await this.providers()).find((candidate) => candidate.id === input.providerId)
    if (!provider) throw new Error(`Managed provider is not registered: ${input.providerId}`)
    if (provider.profileId !== input.profileId) {
      throw new Error(`Provider '${provider.id}' requires profile '${provider.profileId}'.`)
    }
    if (!(await this.core.tasks.root(input.taskId, this.currentUserId()))) {
      throw new Error('The task has no mapped checkout.')
    }
    const parsed = parseAgentTranscript(input.content)
    const session = await this.store.createSession({
      taskId: input.taskId,
      providerId: input.providerId,
      profileId: input.profileId,
      title: input.title ?? parsed.title ?? `Imported ${provider.label} transcript`,
      kind: 'imported',
      config: {
        imported: true,
        importedProviderSessionRef: parsed.providerSessionRef,
        resumeVerified: false,
      },
    }, provider)
    await this.store.setController(session.id, 'external')
    await this.record(session.id, null, {
      type: 'diagnostic',
      level: 'info',
      message: 'Imported transcript. History is read-only until its provider session reference is explicitly verified.',
    })
    for (const imported of parsed.turns) {
      const turn = await this.store.enqueueTurn(session.id, {
        input: [{ type: 'text', text: imported.user }],
        source: 'import',
        effectivePolicy: { imported: true },
        idempotencyKey: randomUUID(),
      })
      await this.store.startTurn(turn.id)
      await this.record(session.id, turn.id, { type: 'user_message', text: imported.user })
      for (const text of imported.assistant) {
        await this.record(session.id, turn.id, { type: 'assistant_message', text })
      }
      await this.record(session.id, turn.id, {
        type: 'turn_completed',
        stopReason: 'imported_history',
      })
    }
    await this.record(session.id, null, {
      type: 'session_state',
      state: 'stopped',
      detail: 'Imported historical transcript.',
    })
    const imported = await this.store.requireSession(session.id)
    this.emit({ channel: 'agent:session', session: imported })
    return imported
  }

  async verifyImportedResume(sessionId: string): Promise<AgentSession> {
    const session = await this.store.requireSession(sessionId)
    if (session.kind !== 'imported') throw new Error('Only imported transcripts require resume verification.')
    const providerSessionRef = session.config.importedProviderSessionRef
    if (typeof providerSessionRef !== 'string' || !providerSessionRef) {
      throw new Error('The imported transcript has no provider session reference.')
    }
    await this.store.setProviderSessionReference(sessionId, providerSessionRef)
    const controlled = await this.store.setController(sessionId, 'acorn')
    try {
      await this.ensureSession(controlled)
    } catch (error) {
      await this.store.setProviderSessionReference(sessionId, null)
      await this.store.setController(sessionId, 'external')
      throw error
    }
    const verified = await this.store.patchSession(sessionId, {
      config: { ...session.config, resumeVerified: true },
    })
    await this.record(sessionId, null, {
      type: 'diagnostic',
      level: 'info',
      message: 'Provider resume reference verified. Acorn now owns the input controller.',
    })
    this.emit({ channel: 'agent:session', session: verified })
    return this.store.requireSession(sessionId)
  }

  async enqueueTurn(sessionId: string, input: EnqueueAgentTurnInput): Promise<AgentTurn> {
    const session = await this.store.requireSession(sessionId)
    if (session.controller !== 'acorn') throw new Error(`Session input is controlled by ${session.controller}.`)
    if (session.archivedAt) throw new Error('Archived sessions cannot accept turns.')
    const cwd = await this.core.tasks.root(session.taskId, this.currentUserId())
    if (!cwd) throw new Error('The task has no mapped checkout.')
    await validateAgentInputFiles(cwd, input.input)
    assertBoundedJson('Effective agent policy', input.effectivePolicy, MAX_AGENT_POLICY_BYTES)
    // Every turn this node accepts passes here, whichever surface enqueued it, so this is where another
    // plugin gets its turn at the prompt (docs/plugins.md § Hooks). Only the text is offered: a
    // transform rewrites what the agent is asked, and a redaction or a policy plugin needs nothing more.
    // Attachments and the effective policy stay the owner's.
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
    const turn = await this.store.enqueueTurn(sessionId, {
      ...enqueued,
      effectivePolicy: {
        ...enqueued.effectivePolicy,
        providerAdvertisedPolicy: providerPolicy,
        providerStatusAuthority: session.statusAuthority,
        capturedAt: Date.now(),
      },
    })
    if (session.runtimeState === 'failed' || session.runtimeState === 'stopped') {
      await this.stopLive(session.id)
    }
    // The command is accepted once the turn is durable. Provider startup/reconnect is a subsequent
    // effect: if it fails, ensureSession records the session error while the turn remains queued.
    // Throwing here after insertion would report a false 500 and leave the client holding a draft
    // that has already been accepted.
    void this.ensureSession(session)
      .then(() => this.pump())
      .catch(() => undefined)
    return turn
  }

  // For a change outside a turn that widens what the dispatcher may start, the concurrency ceilings
  // being the one so far. Without it a raise waits for the next enqueue or completion to take effect,
  // which is the same stall raising the ceiling was meant to clear.
  drainQueue(): void {
    void this.pump()
  }

  async cancelTurn(sessionId: string, turnId?: string): Promise<void> {
    const live = this.live.get(sessionId)
    const active = await this.store.activeTurn(sessionId)
    const target = turnId ?? active?.id
    if (!target) {
      // Stop with nothing to cancel used to return quietly, which made the button a no-op on exactly
      // the session that needed it: the row said 'working', so Stop was enabled, but no turn row
      // existed to cancel and 'working' blocks dispatch, so the next prompt queued forever. Settle the
      // session instead. The provider child is alive and idle, and if it is not, pump respawns it.
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
    await live?.handle?.cancel()
  }

  async patchQueuedTurn(
    sessionId: string,
    turnId: string,
    patch: { input?: AgentTurn['input']; ordinal?: number },
  ): Promise<AgentTurn> {
    if (patch.input) {
      const session = await this.store.requireSession(sessionId)
      const cwd = await this.core.tasks.root(session.taskId, this.currentUserId())
      if (!cwd) throw new Error('The task has no mapped checkout.')
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
    if (patch.config) {
      assertBoundedJson('Agent session configuration', patch.config, MAX_AGENT_CONFIG_BYTES)
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
          // A switched model or reasoning level belongs in the transcript, since it changes what every
          // later turn means. Recorded as a diagnostic row: the transcript already draws those.
          await this.record(sessionId, null, {
            type: 'diagnostic',
            level: 'info',
            message: `${option.label} changed to ${option.valueLabel}`,
          })
        }
        // Every config change goes through this one method, whether the composer sent it or an
        // automation did, so it is the only place that has to notice one to carry it forward.
        if (options.remember !== false) await this.rememberSessionDefaults(before.providerId, changed)
      }
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
    const session = await this.store.patchSession(sessionId, patch)
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
    const snapshot = await this.store.exportSnapshot(sessionId)
    if (format === 'json') return JSON.stringify({ version: 1, exportedAt: Date.now(), ...snapshot }, null, 2)
    const lines = [`# ${snapshot.session.title}`, '', `Provider: ${snapshot.session.providerId}`, '']
    for (const turn of snapshot.turns) {
      lines.push('## User', '', agentTurnInputText(turn), '')
      for (const event of snapshot.events.filter((item) => item.turnId === turn.id)) {
        if (event.event.type === 'assistant_message') lines.push(event.event.text)
        else if (event.event.type === 'tool') lines.push(`- Tool: ${event.event.tool.title} — ${event.event.tool.status ?? 'running'}`)
        else if (event.event.type === 'error') lines.push(`- Error: ${event.event.message}`)
      }
      lines.push('')
    }
    return lines.join('\n')
  }

  async wait(
    sessionId: string,
    afterSeq: number,
    until: WaitCondition,
    timeoutMs: number,
  ): Promise<AgentSessionSnapshot> {
    const initial = await this.store.snapshot(sessionId, afterSeq)
    if (this.conditionMet(initial, until)) return initial
    if (timeoutMs === 0) return initial
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        off()
        void this.store.snapshot(sessionId, afterSeq).then(resolve)
      }, timeoutMs)
      const off = this.subscribe((frame) => {
        if (
          (frame.channel === 'agent:event' && frame.event.sessionId !== sessionId)
          || (frame.channel === 'agent:session' && frame.session.id !== sessionId)
          || frame.channel === 'agent:deleted'
        ) return
        void this.store.snapshot(sessionId, afterSeq).then((snapshot) => {
          if (!this.conditionMet(snapshot, until)) return
          clearTimeout(timeout)
          off()
          resolve(snapshot)
        })
      })
    })
  }


}


export type { AgentRuntimeOptions }
