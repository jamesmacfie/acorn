import type { CoreServices, InternalEnvFactory, PluginDatabase, PluginHookRegistry, PluginTelemetry, SecretService, SpanHandle } from '@acorn/plugin-api/node'
import { createLogger, describeError } from '@acorn/plugin-api/node'
import type {
  AgentEventRecord,
  AgentNormalizedEvent,
  AgentProviderDescriptor,
  AgentSession,
  AgentSessionSnapshot,
  AgentWsFrame,
} from '@acorn/protocol/managedAgents.ts'
import type { AgentSessionChangedEvent } from '@acorn/protocol/nodeEvents.ts'
import type { AgentLifecycleFrame, AgentTurnChangedEvent } from '../../contract/lifecycle'
import { parseToolCeiling } from '@acorn/protocol/workflow.ts'
import { defaultAgentConcurrency } from '../../shared/concurrency'
import { readAgentConcurrency } from '../concurrencyStore'
import { agentDriverRegistry, type AgentDriverRegistry } from '../drivers/registry'
import { safeProviderMessage } from '../drivers/diagnostics'
import type { AgentDriver } from '../drivers/types'
import type { AgentDriverSession } from '../drivers/types'
import { AgentWebhookService, webhookEventKind } from '../webhookService'
import { AgentAttachmentStore } from './attachmentStore'
import { AgentArtifactStore } from './artifactStore'
import { DurableAgentEventBuffer, type PendingAgentEvent } from './durableEventBuffer'
import { AgentStore } from './store'
import { decideAgentCommand } from './stateMachine'
import { ProviderEventMaterializer } from './providerEventMaterializer'
import { agentTurnInputText, buildForkContext } from './runtimeContext'

type PublishedFrame = AgentWsFrame
  | ({ channel: 'agent-session:changed' } & AgentSessionChangedEvent)
  | AgentLifecycleFrame

// Three tags, one owner: the engine's own lines, the memory hand-off, and the webhook queue. The
// tag is what the reader greps for and the owner is what a sink files it under.
const log = createLogger('agents', 'agents')
const webhookLog = createLogger('agents:webhook', 'agents')

export { agentTurnInputText } from './runtimeContext'

type LiveSession = {
  handle: AgentDriverSession | null
  startPromise: Promise<AgentDriverSession> | null
  activeTurnId: string | null
  workspaceId: string
  providerId: string
  stopping: boolean
  reconnectAttempt: number
  acceptedResponse: boolean
  driver: AgentDriver
}

export type AgentRuntimeOptions = {
  // This plugin's own SQLite file (server/plugins/storage.ts), not core's handle. Everything the engine reads
  // and writes is in the ten `agent_*` tables (node/schema.ts).
  db: PluginDatabase
  dataDir: string
  // The three questions this engine has to ask about a task and can no longer answer itself: where its
  // worktree is, which workspace it belongs to (the pump's per-workspace concurrency limit), and
  // whether a webhook's task exists.
  core: CoreServices
  internalEnv: InternalEnvFactory
  secrets: SecretService
  currentUserId(): string | null
  registry?: AgentDriverRegistry
  // Any frame, not only the plugin's own: the core-named `agent-session:changed` goes out through the
  // same door (docs/plugins.md § Hearing a core event).
  publish?(frame: PublishedFrame): void
  startTerminalHandoff?(session: AgentSession): Promise<string>
  terminalHandoffRunning?(sessionId: string): Promise<boolean>
  onCompletedTurn?(event: AgentTurnChangedEvent): Promise<void>
  // The owner's half of this plugin's hooks (docs/plugins.md § Hooks). Optional so a test can build an
  // engine with no host around it, and absent means nobody objects, which is also what an empty chain
  // means.
  hooks?: Pick<PluginHookRegistry, 'run'>
  /** `ctx.telemetry`, so a provider start and an agent turn are spans owned by this plugin
   *  (docs/managed-agents.md § What a session reports). Optional so a test can build an engine with
   *  no host around it. */
  telemetry?: PluginTelemetry
}

export type WaitCondition = 'ready' | 'attention' | 'turn_completed' | 'stopped'
type RuntimeListener = (frame: AgentWsFrame) => void

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000]

const secretEnvironmentValues = (env: Record<string, string>): string[] =>
  Object.entries(env).flatMap(([key, value]) =>
    /(?:TOKEN|SECRET|PASSWORD|AUTH|COOKIE|KEY)/i.test(key) && value ? [value] : [])

const persistedToolCeiling = (config: Record<string, unknown>) => {
  if (!Object.prototype.hasOwnProperty.call(config, 'toolCeiling')) return undefined
  // A corrupt or unrecognized persisted ceiling must remove every tool, never become an unlimited
  // token. Absence remains the ordinary interactive-session behavior: no additional ceiling.
  return parseToolCeiling(config.toolCeiling) ?? { allow: [] }
}

export class ManagedAgentEngine {
  readonly store: AgentStore
  readonly attachments: AgentAttachmentStore
  readonly artifacts: AgentArtifactStore
  readonly webhooks: AgentWebhookService
  protected readonly db: PluginDatabase
  protected readonly core: CoreServices
  protected readonly internalEnv: InternalEnvFactory
  // Every internal token this engine has handed to a provider child, so a leaked value can still be
  // scrubbed out of provider messages and transcripts. Bounded by the number of sessions started.
  protected readonly mintedSecrets: string[] = []
  protected readonly currentUserId: () => string | null
  protected readonly registry: AgentDriverRegistry
  protected readonly publish?: (frame: PublishedFrame) => void
  protected readonly startTerminalHandoff?: (session: AgentSession) => Promise<string>
  protected readonly terminalHandoffRunning?: (sessionId: string) => Promise<boolean>
  protected readonly onCompletedTurn?: (event: AgentTurnChangedEvent) => Promise<void>
  protected readonly hooks?: Pick<PluginHookRegistry, 'run'>
  protected readonly telemetry?: PluginTelemetry
  // The span of every turn this process dispatched and has not seen settle, by turn id. In memory
  // for the reason `live` is: a turn only runs inside the node that started it, and a turn the
  // process died in the middle of reports nothing, which is the honest answer.
  protected readonly turnSpans = new Map<string, SpanHandle>()
  protected readonly live = new Map<string, LiveSession>()
  // A newly persisted session is visible to the client before its provider finishes starting. Hold
  // the driver's early `ready` fact until product initialization (including saved defaults) is done,
  // so `ready` continues to mean that a first turn may use the advertised configuration safely.
  private readonly readinessHolds = new Set<string>()
  // Every in-flight provider reconnect delay (onProviderClosed schedules up to three per session).
  // Tracked so stop() can cancel them: a timer that fires after teardown calls ensureSession, which
  // spawns a provider child against a closed SQLite handle.
  // `apps/node/src/service/runtime.test.ts` starts the runtime several times in one process, so a leaked
  // timer from an earlier boot lands inside a later one.
  protected readonly reconnectTimers = new Set<ReturnType<typeof setTimeout>>()
  protected readonly listeners = new Set<RuntimeListener>()
  protected readonly providerEvents: DurableAgentEventBuffer
  protected readonly eventMaterializer: ProviderEventMaterializer
  protected providerCache: { expiresAt: number; descriptors: AgentProviderDescriptor[] } | null = null
  protected pumping = false
  private readonly pumpIdleWaiters = new Set<() => void>()
  // Set when pump() is called while a scan is already running. That call cannot be a no-op: the scan's
  // queuedHeads snapshot predates the turn that triggered it, and a scan that starts nothing does not
  // loop, so the turn would sit queued until an unrelated event pumped again.
  protected pumpRequested = false
  protected stopped = false
  protected interactiveStreak = 0

  constructor(options: AgentRuntimeOptions) {
    this.db = options.db
    this.core = options.core
    this.internalEnv = options.internalEnv
    this.currentUserId = options.currentUserId
    this.registry = options.registry ?? agentDriverRegistry
    this.publish = options.publish
    this.startTerminalHandoff = options.startTerminalHandoff
    this.terminalHandoffRunning = options.terminalHandoffRunning
    this.onCompletedTurn = options.onCompletedTurn
    this.hooks = options.hooks
    this.telemetry = options.telemetry
    this.store = new AgentStore(options.db, options.core, (frame) => this.publish?.(frame))
    this.attachments = new AgentAttachmentStore(options.db, options.dataDir, options.core)
    this.artifacts = new AgentArtifactStore(options.db, options.dataDir)
    // The redaction list grows as sessions start, rather than being computed once, because each session
    // mints its own scoped internal token (docs/security.md § Credential handling). #mintedSecrets
    // accumulates them and the materializer holds a live reference to the same array.
    this.eventMaterializer = new ProviderEventMaterializer(this.artifacts, this.mintedSecrets)
    this.webhooks = new AgentWebhookService(options.db, options.secrets, options.core)
    this.providerEvents = new DurableAgentEventBuffer((entry) => this.commitProviderEvent(entry))
  }

  subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async providers(force = false): Promise<AgentProviderDescriptor[]> {
    if (!force && this.providerCache && this.providerCache.expiresAt > Date.now()) {
      return this.providerCache.descriptors
    }
    const descriptors = await Promise.all(this.registry.providers().map(async (providerId) => {
      const driver = this.registry.create(providerId)
      if (!driver) throw new Error(`Agent driver disappeared during discovery: ${providerId}`)
      try {
        return await driver.probe()
      } catch (error) {
        return {
          id: providerId,
          profileId: driver.profileId,
          label: providerId,
          driverKind: 'terminal' as const,
          driverVersion: 'unavailable',
          installed: false,
          authenticated: null,
          statusAuthority: 'process' as const,
          capabilities: [],
          configOptions: [],
          commands: [],
          skills: [],
          diagnostics: [error instanceof Error ? error.message : 'Provider discovery failed.'],
        }
      }
    }))
    this.providerCache = { expiresAt: Date.now() + 15_000, descriptors }
    return descriptors
  }

  async reconcile(): Promise<void> {
    for (const session of await this.store.unsettledSessions()) {
      await this.store.interruptActiveTurn(session.id, 'Acorn restarted while the provider turn was active.')
      await this.store.expirePendingRequests(session.id)
      await this.record(session.id, null, {
        type: 'session_state',
        state: 'stopped',
        detail: 'The provider process stopped when Acorn last exited. Send a prompt to resume.',
      })
    }
    await this.attachments.collectGarbage()
    await this.webhooks.reconcile()
    // Turns queued when the process last exited have nothing else to wake them: pump() runs on enqueue,
    // on a provider start, and when a turn settles, none of which happen on their own after a restart.
    // Not awaited, because draining spawns a provider child per session and boot waits on reconcile().
    void this.pump()
  }

  // Releases what this engine holds, in the order docs/managed-agents.md § Operations and failure
  // describes. Called from the plugin's dispose (node/index.ts) before the database closes.
  async stop(): Promise<void> {
    this.stopped = true
    for (const timer of this.reconnectTimers) clearTimeout(timer)
    this.reconnectTimers.clear()
    await Promise.all([...this.live.keys()].map((sessionId) => this.stopLive(sessionId)))
    if (this.pumping) {
      await new Promise<void>((resolve) => this.pumpIdleWaiters.add(resolve))
    }
    await this.providerEvents.flushAll()
    await this.webhooks.stop()
    this.turnSpans.clear()
    this.listeners.clear()
    this.eventMaterializer.clear()
    this.providerCache = null
  }

  protected holdSessionReadiness(sessionId: string): void {
    this.readinessHolds.add(sessionId)
  }

  protected discardSessionReadinessHold(sessionId: string): void {
    this.readinessHolds.delete(sessionId)
  }

  protected async completeSessionReadiness(sessionId: string): Promise<void> {
    this.readinessHolds.delete(sessionId)
    if (this.stopped) return
    await this.record(sessionId, null, { type: 'session_state', state: 'ready' })
    void this.pump()
  }

  protected async ensureSession(session: AgentSession): Promise<LiveSession> {
    // The only door into spawning or reconnecting a provider child. Checked here, not at each call
    // site, because after stop() the database handle is about to close and a turn still in flight
    // through pump() could otherwise start a provider mid-teardown.
    if (this.stopped) throw new Error('The managed agent runtime is shutting down.')
    const existing = this.live.get(session.id)
    if (existing?.handle) return existing
    if (existing?.startPromise) {
      await existing.startPromise
      return existing
    }
    if (session.controller !== 'acorn') throw new Error(`Session input is controlled by ${session.controller}.`)
    const cwd = await this.core.tasks.root(session.taskId, this.currentUserId())
    if (!cwd) throw new Error('The task has no mapped checkout.')
    const workspaceId = await this.core.tasks.workspaceId(session.taskId)
    const driver = this.registry.create(session.providerId)
    if (!driver) throw new Error(`Managed provider is not registered: ${session.providerId}`)
    const live: LiveSession = existing ?? {
      handle: null,
      startPromise: null,
      activeTurnId: null,
      workspaceId,
      providerId: session.providerId,
      stopping: false,
      reconnectAttempt: 0,
      acceptedResponse: false,
      driver,
    }
    live.workspaceId = workspaceId
    live.providerId = session.providerId
    live.driver = driver
    live.stopping = false
    this.live.set(session.id, live)
    const noProviderExecutionHistory = !(await this.store.hasProviderExecutionHistory(session.id))
    // Scoped to this session's task (docs/security.md § Credential handling). The credential cannot
    // drive another task's tools or read the owner's provider credentials.
    const sessionEnv = this.internalEnv({
      scope: 'task',
      taskId: session.taskId,
      sessionId: session.id,
      // The session row is the authority across restarts. Workflow creation and later delegation
      // persist the effective intersection here before any provider process is started.
      toolCeiling: persistedToolCeiling(session.config),
    })
    for (const secret of secretEnvironmentValues(sessionEnv)) if (!this.mintedSecrets.includes(secret)) this.mintedSecrets.push(secret)
    // The session's span covers starting the provider, not the session's whole life. A session
    // lives for hours and outlives the process, and a span nobody can close is not a measurement;
    // spawning or reconnecting the child is the part something waited on
    // (docs/telemetry.md § The admission rule for a span).
    const span = this.telemetry?.startSpan('agent.session', {
      attrs: { seam: 'agent.session', 'session.id': session.id, provider: session.providerId, reconnect: live.reconnectAttempt > 0 },
    })
    live.startPromise = driver.start({
      session,
      cwd,
      env: sessionEnv,
      noProviderExecutionHistory,
      onEvent: (event) => this.onProviderEvent(session.id, event),
      onClosed: (error) => this.onProviderClosed(session.id, error),
    })
    try {
      const handle = await live.startPromise
      // stopLive waits for the same start promise and owns stopping the handle. The starter must not
      // republish readiness or repopulate `live` while teardown is draining it.
      if (this.stopped || live.stopping) throw new Error('The managed agent runtime is shutting down.')
      live.handle = handle
      live.reconnectAttempt = 0
      span?.end('ok')
      void this.pump()
      return live
    } catch (error) {
      span?.end('error')
      this.live.delete(session.id)
      if (this.stopped || live.stopping) throw error
      await this.record(session.id, null, {
        type: 'error',
        code: 'provider_start_failed',
        message: safeProviderMessage(
          error,
          'Provider session failed to start.',
          this.mintedSecrets,
        ),
        retryable: false,
      })
      throw error
    } finally {
      live.startPromise = null
    }
  }

  protected async onProviderEvent(sessionId: string, event: AgentNormalizedEvent): Promise<void> {
    if (
      event.type === 'session_state'
      && event.state === 'ready'
      && this.readinessHolds.has(sessionId)
    ) return
    const live = this.live.get(sessionId)
    if (live && !['session_state', 'session_metadata', 'diagnostic', 'error'].includes(event.type)) {
      live.acceptedResponse = true
    }
    const turnId = live?.activeTurnId ?? null
    for (const normalized of await this.eventMaterializer.map(sessionId, turnId, event)) {
      await this.providerEvents.accept({ sessionId, turnId, event: normalized })
    }
  }

  protected async commitProviderEvent({ sessionId, event, turnId }: PendingAgentEvent): Promise<void> {
    const live = this.live.get(sessionId)
    const settlesTurn = event.type === 'turn_completed' || event.type === 'error'
    if (settlesTurn) {
      if (live) live.activeTurnId = null
      if (turnId) this.endTurnSpan(turnId, event.type === 'error' ? 'error' : 'completed')
    }
    await this.record(sessionId, turnId, event)
    if (settlesTurn) {
      if (event.type === 'turn_completed' && turnId && this.onCompletedTurn) {
        const session = await this.store.requireSession(sessionId)
        const turn = await this.store.turn(turnId)
        if (turn) void this.onCompletedTurn({
          taskId: session.taskId,
          sessionId,
          turnId,
          source: turn.source,
          status: turn.status,
          attempt: turn.attempt,
        }).catch((error: unknown) => log.warn(`completed-turn observer failed: ${describeError(error).message}`))
      }
      void this.pump()
    }
  }

  protected async onProviderClosed(sessionId: string, error?: Error): Promise<void> {
    const live = this.live.get(sessionId)
    if (!live || live.stopping || this.stopped) return
    const message = safeProviderMessage(
      error,
      'Provider process closed.',
      this.mintedSecrets,
    )
    await this.store.interruptActiveTurn(sessionId, message)
    await this.store.expirePendingRequests(sessionId)
    if (live.activeTurnId) this.endTurnSpan(live.activeTurnId, 'interrupted')
    live.activeTurnId = null
    live.handle = null
    const attempt = live.reconnectAttempt++
    if (attempt >= RECONNECT_DELAYS_MS.length) {
      this.live.delete(sessionId)
      await this.record(sessionId, null, { type: 'error', code: 'provider_disconnected', message, retryable: false })
      return
    }
    await this.record(sessionId, null, { type: 'session_state', state: 'reconnecting', detail: message })
    // Tracked and unref'd. Tracked so stop() cancels it; unref'd so a node draining between two
    // reconnect attempts is not held open by a delay nobody is waiting on.
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(timer)
      if (this.stopped) return
      void this.store.requireSession(sessionId)
        .then((session) => this.ensureSession(session))
        .catch(() => undefined)
    }, RECONNECT_DELAYS_MS[attempt])
    timer.unref?.()
    this.reconnectTimers.add(timer)
  }

  protected async pump(): Promise<void> {
    if (this.stopped) return
    if (this.pumping) {
      this.pumpRequested = true
      return
    }
    this.pumping = true
    try {
      for (;;) {
        this.pumpRequested = false
        const heads = await this.store.queuedHeads()
        // Read per pass, not captured: the owner can change the ceilings while turns are queued, and a
        // raise has to apply to the scan the write triggers. One indexed row read per pass.
        const userId = this.currentUserId()
        const limits = userId
          ? await readAgentConcurrency(this.core.prefs, userId)
          : defaultAgentConcurrency()
        const workspaceActive = new Map<string, number>()
        const providerActive = new Map<string, number>()
        for (const live of this.live.values()) {
          if (!live.activeTurnId) continue
          workspaceActive.set(live.workspaceId, (workspaceActive.get(live.workspaceId) ?? 0) + 1)
          providerActive.set(live.providerId, (providerActive.get(live.providerId) ?? 0) + 1)
        }
        const sorted = heads.sort((a, b) => {
          const aInteractive = a.turn.source === 'interactive' || a.turn.source === 'automation'
          const bInteractive = b.turn.source === 'interactive' || b.turn.source === 'automation'
          if (this.interactiveStreak >= 5 && aInteractive !== bInteractive) return aInteractive ? 1 : -1
          if (aInteractive !== bInteractive) return aInteractive ? -1 : 1
          return a.turn.createdAt - b.turn.createdAt
        })
        let started = false
        for (const item of sorted) {
          const live = await this.ensureSession(item.session).catch(() => null)
          if (!live?.handle?.ready || live.activeTurnId || live.stopping || this.stopped) continue
          const currentSession = await this.store.requireSession(item.session.id)
          const decision = decideAgentCommand({
            runtimeState: currentSession.runtimeState,
            attention: currentSession.attention,
            activeTurnId: live.activeTurnId,
            pendingRequestIds: [],
          }, { type: 'dispatch_turn', turnId: item.turn.id })
          if (!decision.ok) continue
          if ((workspaceActive.get(live.workspaceId) ?? 0) >= limits.workspace) continue
          if ((providerActive.get(live.providerId) ?? 0) >= limits.provider) continue
          live.activeTurnId = item.turn.id
          live.acceptedResponse = false
          workspaceActive.set(live.workspaceId, (workspaceActive.get(live.workspaceId) ?? 0) + 1)
          providerActive.set(live.providerId, (providerActive.get(live.providerId) ?? 0) + 1)
          this.interactiveStreak = item.turn.source === 'workflow' ? 0 : this.interactiveStreak + 1
          await this.store.dispatchTurn(item.turn.id)
          try {
            await this.record(item.session.id, item.turn.id, { type: 'user_message', text: agentTurnInputText(item.turn) })
            const attachments = Object.fromEntries((await Promise.all(
              [...new Set(item.turn.input.flatMap((part) =>
                part.type === 'attachment' || part.type === 'image' ? [part.attachmentId] : []))]
                .map(async (attachmentId) => {
                  const attachment = await this.attachments.resolve(attachmentId)
                  if (!attachment) throw new Error(`Attachment is unavailable: ${attachmentId}`)
                  return [attachmentId, {
                    id: attachment.id,
                    filename: attachment.filename,
                    mediaType: attachment.mediaType,
                    byteSize: attachment.byteSize,
                    localPath: attachment.localPath,
                  }] as const
                }),
            )))
            await this.store.startTurn(item.turn.id)
            this.beginTurnSpan(item.turn.id, item.session.id, live.providerId, item.turn.source)
            void live.handle.sendTurn({ turn: item.turn, input: item.turn.input, attachments })
            .then(async (result) => {
              if (result.providerTurnRef) await this.store.setTurnProviderRef(item.turn.id, result.providerTurnRef)
            })
            .catch(async (error) => {
              if (live.activeTurnId !== item.turn.id) return
              live.activeTurnId = null
              const failure = live.driver.classifyTurnFailure?.(error) ?? 'uncertain'
              if (
                failure === 'safe_transient'
                && !live.acceptedResponse
                && item.turn.attempt + 1 < 3
              ) {
                const message = safeProviderMessage(
                  error,
                  'Safe transient provider failure.',
                  this.mintedSecrets,
                )
                // The same turn id starts again, so its first attempt's span has to close here or
                // the next attempt would replace an open handle in the map.
                this.endTurnSpan(item.turn.id, 'requeued')
                await this.store.requeueTransientTurn(item.turn.id, message)
                await this.record(item.session.id, item.turn.id, {
                  type: 'diagnostic',
                  level: 'warning',
                  message: `Provider rejected the turn before accepting output; retrying (${item.turn.attempt + 2}/3).`,
                })
                await this.record(item.session.id, item.turn.id, {
                  type: 'session_state',
                  state: 'ready',
                  detail: 'Safely retrying an undispatched provider turn.',
                })
                void this.pump()
                return
              }
              await this.providerEvents.accept({
                sessionId: item.session.id,
                turnId: item.turn.id,
                event: {
                type: 'error',
                code: 'turn_dispatch_failed',
                message: safeProviderMessage(
                  error,
                  'Provider turn failed.',
                  this.mintedSecrets,
                ),
                retryable: false,
                },
              })
              void this.pump()
            })
          } catch (error) {
            live.activeTurnId = null
            await this.providerEvents.accept({
              sessionId: item.session.id,
              turnId: item.turn.id,
              event: {
                type: 'error',
                code: 'turn_dispatch_failed',
                message: safeProviderMessage(error, 'Agent turn preparation failed.', this.mintedSecrets),
                retryable: false,
              },
            })
          }
          started = true
        }
        // Rescan while there is a reason to: a start moves that session on to its next queued head, and
        // a pump call raised during the pass wants a queue snapshot newer than the one it read.
        if (!started && !this.pumpRequested) return
      }
    } finally {
      this.pumping = false
      for (const resolve of this.pumpIdleWaiters) resolve()
      this.pumpIdleWaiters.clear()
    }
  }

  protected async record(
    sessionId: string,
    turnId: string | null,
    event: AgentNormalizedEvent,
  ): Promise<AgentEventRecord> {
    const record = await this.store.recordEvent(sessionId, turnId, event)
    this.emit({ channel: 'agent:event', event: record })
    await this.emitProjection(sessionId, turnId, event)
    const session = await this.store.requireSession(sessionId)
    this.emit({ channel: 'agent:session', session })
    return record
  }

  // The row a projected event changed, sent with the event.
  //
  // `recordEvent` writes the request row in the same transaction as the event, and a turn's status is
  // already committed by the time its `turn_completed` is recorded, so the node knows what changed. It
  // used to say nothing, and every client answered a `turn_completed` by refetching the whole snapshot
  // — up to 2,000 event rows and a JSON body parsed per row — to learn one turn's stop reason
  // (../../client/sessions/managedStore.ts § PROJECTED_EVENT_TYPES).
  //
  // `error` is deliberately not here: it also expires this session's pending requests, which is a set
  // this projection cannot name, so the client still refetches for that one.
  protected async emitProjection(
    sessionId: string,
    turnId: string | null,
    event: AgentNormalizedEvent,
  ): Promise<void> {
    if (event.type === 'request' || event.type === 'request_resolved') {
      const request = await this.store.request(sessionId, event.requestId)
      if (request) this.emit({ channel: 'agent:request', request })
      return
    }
    if (!turnId || (event.type !== 'user_message' && event.type !== 'turn_completed')) return
    const turn = await this.store.turn(turnId)
    if (turn) this.emit({ channel: 'agent:turn', turn })
  }

  protected emit(frame: AgentWsFrame): void {
    this.publish?.(frame)
    for (const listener of this.listeners) listener(frame)
    void this.webhooks.accept(frame).catch((error) => {
      webhookLog.warn(`failed to queue delivery: ${describeError(error).message}`)
    })
    void this.announce(frame).catch((error) => {
      log.warn(`failed to announce a session edge: ${describeError(error).message}`)
    })
  }

  // The webhook filter pointed inward: the same two edges, on a core channel every window and any
  // plugin's node half can hear. Third parties are otherwise blind to agent execution, since the
  // `agent:` prefix is the plugin's own.
  protected async announce(frame: AgentWsFrame): Promise<void> {
    const event = webhookEventKind(frame)
    if (!event || frame.channel !== 'agent:event') return
    const session = await this.store.requireSession(frame.event.sessionId)
    this.publish?.({ channel: 'agent-session:changed', taskId: session.taskId, sessionId: session.id, event })
  }

  protected conditionMet(snapshot: AgentSessionSnapshot, until: WaitCondition): boolean {
    if (until === 'ready') return snapshot.session.runtimeState === 'ready'
    if (until === 'attention') return !['none', 'unread'].includes(snapshot.session.attention)
    if (until === 'stopped') return ['stopped', 'failed', 'archived'].includes(snapshot.session.runtimeState)
    return snapshot.events.some((event) => event.event.type === 'turn_completed' || event.event.type === 'error')
  }

  /** A turn's span, opened where the turn is dispatched to a provider. Not where it was enqueued:
   *  a turn can sit in the queue behind the concurrency limit for minutes, and "how long did the
   *  agent take" is not "how long was the node busy". */
  protected beginTurnSpan(turnId: string, sessionId: string, providerId: string, source: string): void {
    const span = this.telemetry?.startSpan('agent.turn', {
      attrs: { seam: 'agent.turn', 'turn.id': turnId, 'session.id': sessionId, provider: providerId, source },
    })
    if (span) this.turnSpans.set(turnId, span)
  }

  /** Close it, from whichever of the four ways a turn stops being active got there first. `end` is
   *  idempotent, so a race between a provider closing and its last event arriving costs nothing. */
  protected endTurnSpan(turnId: string, outcome: 'completed' | 'error' | 'interrupted' | 'requeued'): void {
    const span = this.turnSpans.get(turnId)
    this.turnSpans.delete(turnId)
    span?.end(outcome === 'completed' ? 'ok' : 'error', { outcome })
  }

  protected forkContext(source: AgentSession): ReturnType<typeof buildForkContext> {
    return buildForkContext(this.store, source)
  }

  protected async stopLive(sessionId: string): Promise<void> {
    const live = this.live.get(sessionId)
    if (!live) return
    live.stopping = true
    this.live.delete(sessionId)
    const handle = live.handle ?? await live.startPromise?.catch(() => null)
    if (handle) await handle.stop().catch(() => undefined)
    await this.providerEvents.flush(sessionId)
  }
}
