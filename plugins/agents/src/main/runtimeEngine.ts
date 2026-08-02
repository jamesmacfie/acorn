import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '@acorn/node-core/server/db/index.ts'
import { taskRoot, workspaceIdFor } from '@acorn/node-core/main/taskWorktree.ts'
import type {
  AgentEventRecord,
  AgentNormalizedEvent,
  AgentProviderDescriptor,
  AgentSession,
  AgentSessionSnapshot,
  AgentTurn,
  AgentWsFrame,
} from '@acorn/protocol/managedAgents.ts'
import { agentDriverRegistry, type AgentDriverRegistry } from './drivers/registry'
import type { AgentDriverSession } from './drivers/types'
import type { AgentDriver } from './drivers/types'
import { safeProviderMessage } from './drivers/diagnostics'
import { AgentAttachmentStore } from './attachmentStore'
import { AgentArtifactStore } from './artifactStore'
import { DurableAgentEventBuffer, type PendingAgentEvent } from './durableEventBuffer'
import { AgentStore } from './store'
import { decideAgentCommand } from './stateMachine'
import { AgentWebhookService } from './webhookService'
import { ProviderEventMaterializer } from './providerEventMaterializer'

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
  db: AppDatabase
  dataDir: string
  internalApiEnv: Record<string, string>
  encryptionKey: string
  currentUserId(): string | null
  registry?: AgentDriverRegistry
  publish?(frame: AgentWsFrame): void
  startTerminalHandoff?(session: AgentSession): Promise<string>
  terminalHandoffRunning?(sessionId: string): Promise<boolean>
  onCompletedTurn?(taskId: string, transcriptTail: string): Promise<void>
}

export type WaitCondition = 'ready' | 'attention' | 'turn_completed' | 'stopped'
type RuntimeListener = (frame: AgentWsFrame) => void

const WORKSPACE_ACTIVE_LIMIT = 3
const PROVIDER_ACTIVE_LIMIT = 2
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000]

const secretEnvironmentValues = (env: Record<string, string>): string[] =>
  Object.entries(env).flatMap(([key, value]) =>
    /(?:TOKEN|SECRET|PASSWORD|AUTH|COOKIE|KEY)/i.test(key) && value ? [value] : [])

export const agentTurnInputText = (turn: AgentTurn): string =>
  turn.input.flatMap((part) => {
    if (part.type === 'text') return [part.text]
    if (part.type === 'file') return [`@${part.path}`]
    if (part.type === 'context') return [`[Context: ${part.label}]`]
    return [`[Attachment: ${part.attachmentId}]`]
  }).join('\n\n')

export class ManagedAgentEngine {
  readonly store: AgentStore
  readonly attachments: AgentAttachmentStore
  readonly artifacts: AgentArtifactStore
  readonly webhooks: AgentWebhookService
  protected readonly db: AppDatabase
  protected readonly internalApiEnv: Record<string, string>
  protected readonly currentUserId: () => string | null
  protected readonly registry: AgentDriverRegistry
  protected readonly publish?: (frame: AgentWsFrame) => void
  protected readonly startTerminalHandoff?: (session: AgentSession) => Promise<string>
  protected readonly terminalHandoffRunning?: (sessionId: string) => Promise<boolean>
  protected readonly onCompletedTurn?: (taskId: string, transcriptTail: string) => Promise<void>
  protected readonly live = new Map<string, LiveSession>()
  protected readonly listeners = new Set<RuntimeListener>()
  protected readonly providerEvents: DurableAgentEventBuffer
  protected readonly eventMaterializer: ProviderEventMaterializer
  protected providerCache: { expiresAt: number; descriptors: AgentProviderDescriptor[] } | null = null
  protected pumping = false
  protected stopped = false
  protected interactiveStreak = 0

  constructor(options: AgentRuntimeOptions) {
    this.db = options.db
    this.internalApiEnv = options.internalApiEnv
    this.currentUserId = options.currentUserId
    this.registry = options.registry ?? agentDriverRegistry
    this.publish = options.publish
    this.startTerminalHandoff = options.startTerminalHandoff
    this.terminalHandoffRunning = options.terminalHandoffRunning
    this.onCompletedTurn = options.onCompletedTurn
    this.store = new AgentStore(options.db)
    this.attachments = new AgentAttachmentStore(options.db, options.dataDir)
    this.artifacts = new AgentArtifactStore(options.db, options.dataDir)
    this.eventMaterializer = new ProviderEventMaterializer(
      this.artifacts,
      secretEnvironmentValues(this.internalApiEnv),
    )
    this.webhooks = new AgentWebhookService(options.db, options.encryptionKey)
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
  }

  async stop(): Promise<void> {
    this.stopped = true
    await Promise.all([...this.live.keys()].map((sessionId) => this.stopLive(sessionId)))
    await this.providerEvents.flushAll()
    await this.webhooks.stop()
    this.listeners.clear()
    this.eventMaterializer.clear()
  }

  protected async ensureSession(session: AgentSession): Promise<LiveSession> {
    const existing = this.live.get(session.id)
    if (existing?.handle) return existing
    if (existing?.startPromise) {
      await existing.startPromise
      return existing
    }
    if (session.controller !== 'acorn') throw new Error(`Session input is controlled by ${session.controller}.`)
    const cwd = await taskRoot(this.db, session.taskId, this.currentUserId())
    if (!cwd) throw new Error('The task has no mapped checkout.')
    const workspaceId = await workspaceIdFor(this.db, session.taskId)
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
    live.startPromise = driver.start({
      session,
      cwd,
      env: this.internalApiEnv,
      noProviderExecutionHistory,
      onEvent: (event) => this.onProviderEvent(session.id, event),
      onClosed: (error) => this.onProviderClosed(session.id, error),
    })
    try {
      live.handle = await live.startPromise
      live.reconnectAttempt = 0
      void this.pump()
      return live
    } catch (error) {
      this.live.delete(session.id)
      await this.record(session.id, null, {
        type: 'error',
        code: 'provider_start_failed',
        message: safeProviderMessage(
          error,
          'Provider session failed to start.',
          secretEnvironmentValues(this.internalApiEnv),
        ),
        retryable: false,
      })
      throw error
    } finally {
      live.startPromise = null
    }
  }

  protected async onProviderEvent(sessionId: string, event: AgentNormalizedEvent): Promise<void> {
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
    await this.record(sessionId, turnId, event)
    if (event.type === 'turn_completed' || event.type === 'error') {
      if (live) live.activeTurnId = null
      if (event.type === 'turn_completed' && turnId && this.onCompletedTurn) {
        void this.completedTurnTranscript(sessionId, turnId)
          .then(({ taskId, transcript }) => this.onCompletedTurn!(taskId, transcript))
          .catch((error) => console.warn('[agents:memory] completed-turn extraction failed:', error))
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
      secretEnvironmentValues(this.internalApiEnv),
    )
    await this.store.interruptActiveTurn(sessionId, message)
    await this.store.expirePendingRequests(sessionId)
    live.activeTurnId = null
    live.handle = null
    const attempt = live.reconnectAttempt++
    if (attempt >= RECONNECT_DELAYS_MS.length) {
      this.live.delete(sessionId)
      await this.record(sessionId, null, { type: 'error', code: 'provider_disconnected', message, retryable: false })
      return
    }
    await this.record(sessionId, null, { type: 'session_state', state: 'reconnecting', detail: message })
    setTimeout(() => {
      void this.store.requireSession(sessionId)
        .then((session) => this.ensureSession(session))
        .catch(() => undefined)
    }, RECONNECT_DELAYS_MS[attempt])
  }

  protected async pump(): Promise<void> {
    if (this.pumping || this.stopped) return
    this.pumping = true
    try {
      for (;;) {
        const heads = await this.store.queuedHeads()
        if (heads.length === 0) return
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
          if (!live?.handle?.ready || live.activeTurnId) continue
          const currentSession = await this.store.requireSession(item.session.id)
          const decision = decideAgentCommand({
            runtimeState: currentSession.runtimeState,
            attention: currentSession.attention,
            activeTurnId: live.activeTurnId,
            pendingRequestIds: [],
          }, { type: 'dispatch_turn', turnId: item.turn.id })
          if (!decision.ok) continue
          if ((workspaceActive.get(live.workspaceId) ?? 0) >= WORKSPACE_ACTIVE_LIMIT) continue
          if ((providerActive.get(live.providerId) ?? 0) >= PROVIDER_ACTIVE_LIMIT) continue
          live.activeTurnId = item.turn.id
          live.acceptedResponse = false
          workspaceActive.set(live.workspaceId, (workspaceActive.get(live.workspaceId) ?? 0) + 1)
          providerActive.set(live.providerId, (providerActive.get(live.providerId) ?? 0) + 1)
          this.interactiveStreak = item.turn.source === 'workflow' ? 0 : this.interactiveStreak + 1
          await this.store.startTurn(item.turn.id)
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
                  secretEnvironmentValues(this.internalApiEnv),
                )
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
                  secretEnvironmentValues(this.internalApiEnv),
                ),
                retryable: false,
                },
              })
              void this.pump()
            })
          started = true
        }
        if (!started) return
      }
    } finally {
      this.pumping = false
    }
  }

  protected async record(
    sessionId: string,
    turnId: string | null,
    event: AgentNormalizedEvent,
  ): Promise<AgentEventRecord> {
    const record = await this.store.recordEvent(sessionId, turnId, event)
    this.emit({ channel: 'agent:event', event: record })
    const session = await this.store.requireSession(sessionId)
    this.emit({ channel: 'agent:session', session })
    return record
  }

  protected emit(frame: AgentWsFrame): void {
    this.publish?.(frame)
    for (const listener of this.listeners) listener(frame)
    void this.webhooks.accept(frame).catch((error) => {
      console.warn('[agents:webhook] failed to queue delivery:', error)
    })
  }

  protected conditionMet(snapshot: AgentSessionSnapshot, until: WaitCondition): boolean {
    if (until === 'ready') return snapshot.session.runtimeState === 'ready'
    if (until === 'attention') return !['none', 'unread'].includes(snapshot.session.attention)
    if (until === 'stopped') return ['stopped', 'failed', 'archived'].includes(snapshot.session.runtimeState)
    return snapshot.events.some((event) => event.event.type === 'turn_completed' || event.event.type === 'error')
  }

  protected async completedTurnTranscript(sessionId: string, turnId: string): Promise<{ taskId: string; transcript: string }> {
    const [snapshot, events] = await Promise.all([
      this.store.snapshot(sessionId, 0, 1),
      this.store.eventsForTurn(turnId),
    ])
    const turn = snapshot.turns.find((candidate) => candidate.id === turnId)
    const lines = [
      `Managed agent session: ${snapshot.session.id}`,
      `Managed agent turn: ${turnId}`,
      `Provider: ${snapshot.session.providerId}`,
      '',
      turn ? `User:\n${agentTurnInputText(turn)}` : '',
      ...events.flatMap((record) => {
        if (record.event.type === 'assistant_message') return [`Assistant:\n${record.event.text}`]
        if (record.event.type === 'tool') return [`Tool: ${record.event.tool.title} (${record.event.tool.status})`]
        if (record.event.type === 'file_change') return [`File change: ${record.event.path ?? record.event.summary ?? 'unknown'}`]
        return []
      }),
    ].filter(Boolean)
    return { taskId: snapshot.session.taskId, transcript: lines.join('\n\n').slice(-20_000) }
  }

  protected async forkContext(source: AgentSession): Promise<Extract<AgentTurn['input'][number], { type: 'context' }>> {
    const snapshot = await this.store.exportSnapshot(source.id)
    const lines = snapshot.events.slice(-200).flatMap((record) => {
      if (record.event.type === 'user_message') return [`User:\n${record.event.text}`]
      if (record.event.type === 'assistant_message') return [`Assistant:\n${record.event.text}`]
      if (record.event.type === 'file_change') {
        return [`File change: ${record.event.path ?? record.event.summary ?? 'unspecified'}`]
      }
      if (record.event.type === 'plan') {
        return [`Plan:\n${record.event.entries.map((entry) => `- [${entry.status}] ${entry.text}`).join('\n')}`]
      }
      return []
    })
    const content = lines.join('\n\n').slice(-100_000)
    const snapshotContent = [
      'This is an explicit Acorn context-copy fork, not provider-native history.',
      'The provider has not seen this snapshot until it is included with a new turn.',
      '',
      content || '(The source session has no displayable conversation events.)',
    ].join('\n')
    return {
      type: 'context',
      contextId: randomUUID(),
      label: `History copied from ${source.title}`,
      content: snapshotContent,
      source: 'agents',
      resourceId: source.id,
      provenance: `Managed session ${source.id}, events through sequence ${source.lastEventSeq}`,
      deepLink: { pane: 'agents', intent: { sessionId: source.id } },
      byteSize: Buffer.byteLength(snapshotContent, 'utf8'),
      estimatedTokens: Math.ceil(Buffer.byteLength(snapshotContent, 'utf8') / 4),
      freshness: 'cached',
      sensitivity: 'workspace',
      capturedAt: Date.now(),
    }
  }

  protected async stopLive(sessionId: string): Promise<void> {
    const live = this.live.get(sessionId)
    if (!live) return
    live.stopping = true
    this.live.delete(sessionId)
    if (live.handle) await live.handle.stop().catch(() => undefined)
    await this.providerEvents.flush(sessionId)
  }
}
