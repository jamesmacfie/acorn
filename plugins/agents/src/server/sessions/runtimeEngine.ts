import { awaitWithSignal } from '../processes/startCancellation'
import type { CoreServices, InternalEnvFactory, Launcher, PluginDatabase, PluginHookRegistry, PluginTelemetry, SecretService, SpanHandle } from '@acorn/plugin-api/node'
import { agentProfileRegistry, createLogger, describeError } from '@acorn/plugin-api/node'
import type {
  AgentEventRecord,
  AgentConfigOption,
  AgentNormalizedEvent,
  AgentProviderDescriptor,
  AgentSession,
  AgentTurn,
  AgentWsFrame,
} from '../../contract/wire.ts'
import type { AgentDriverEvent, AgentDriverMcpServer } from '../drivers/types'
import { AgentMcpServerStore } from '../mcpServerStore'
import { sessionMcpSelection } from '../../shared/mcpServers'
import type { AgentSessionChangedEvent } from '@acorn/protocol/nodeEvents.ts'
import type { AgentLifecycleFrame } from '../../contract/lifecycle'
import { parseToolCeiling } from '@acorn/protocol/toolPolicy.ts'
import { defaultAgentConcurrency } from '../../shared/concurrency'
import { readAgentConcurrency } from '../concurrencyStore'
import { AGENT_IDLE_STOP_CHOICES, defaultAgentSessionDefaults } from '../../shared/sessionDefaults'
import { readAgentSessionDefaults } from '../sessionDefaultsStore'
import { agentDriverRegistry, type AgentDriverRegistry } from '../drivers/registry'
import { safeProviderMessage } from '../drivers/diagnostics'
import { AgentWebhookService, webhookEventKind } from '../webhookService'
import { AgentAttachmentStore } from './attachmentStore'
import { AgentArtifactStore } from './artifactStore'
import { DurableAgentEventBuffer, type PendingAgentEvent } from './durableEventBuffer'
import { compactLedgers } from './ledgerCompaction'
import type { ProcessRow } from './footprint'
import { AgentStore } from './store'
import { QueueCoordinator } from './queueCoordinator'
import { ProviderSessionLifecycle, type ProviderGeneration } from './providerSessionLifecycle'
import type { AgentDriverSession } from '../drivers/types'
import { clientEventRecord } from './rowMapping'
import {
  eventSubagentId,
  isActiveSubagent,
  quietedSubagents,
  SUBAGENT_QUIET_MS,
} from './stateMachine'
import { ProviderEventMaterializer } from './providerEventMaterializer'
import { agentTurnInputText, buildForkContext } from './runtimeContext'
import {
  mayBeUsageLimit,
  USAGE_CONTINUATION_GRACE_MS,
  usageContinuationInput,
  usageContinuationMessage,
} from './usageContinuation'

/**
 * A session row as a client keeps it, for telling whether a recorded event changed it.
 *
 * It leaves out five fields. `lastEventSeq`, `lastEventAt` and `updatedAt` move with every event, and
 * the client reads the event frame for the one of them it needs live (../../client/sessions/managedStore.ts
 * § eventSeqs). `lastEventAt` drives the sidebar's "latest activity" order, so that order re-sorts when
 * a turn starts or ends rather than on every streamed chunk. A
 * subagent's `updatedAt` is the node's clock for quieting a silent child, and moves with every tool call
 * the child makes. The task sidebar's tooltip reads it only as of the row's last broadcast. The status
 * that quieting changes is still compared. `config` is too large to compare per event, and
 * record() handles it separately.
 */
const listedRow = (session: AgentSession): string => JSON.stringify({
  ...session,
  config: null,
  lastEventSeq: 0,
  lastEventAt: 0,
  updatedAt: 0,
  subagents: session.subagents.map(({ updatedAt: _heardAt, ...entry }) => entry),
})

/**
 * acorn's own tool servers for one session, or none.
 *
 * ACP harnesses with CLI registration use that registration; other ACP harnesses receive a protocol
 * declaration. Managed Codex always receives a declaration under the registered server's name, which
 * overrides its config-file entry. Codex filters inherited MCP environment variables, so registration
 * alone drops the signed task context and leaves the server with no tools.
 *
 * An unregistered profile gets nothing either. The session could not have started without one, so this
 * is a broken state rather than a case, and the conservative answer is not to hand a credential to it.
 *
 * The environment is spelled out rather than inherited. The agent process already holds these values,
 * because the session environment is what acorn spawned it with, but an agent is free to scrub
 * credential-shaped names out of what it passes its own children, and a stdio MCP server that loses
 * `ACORN_API_TOKEN` or `ACORN_TASK_ID` fails every call. The session environment carries both, plus
 * `ACORN_SESSION_ID`; the token, not these, is what the node trusts for the task, the session, and the
 * tool ceiling (docs/mcp.md § Launch environment).
 */
export function acornMcpServers(
  mcp: { name: string; launcher: Launcher } | null,
  session: Pick<AgentSession, 'profileId' | 'driverKind'>,
  sessionEnv: Record<string, string>,
): AgentDriverMcpServer[] {
  if (!mcp) return []
  const profile = agentProfileRegistry.get(session.profileId)
  if (!profile || (profile.mcpRegistration && session.driverKind !== 'codex-app-server')) return []
  return [{
    transport: 'stdio',
    name: mcp.name,
    command: mcp.launcher.command,
    args: mcp.launcher.args,
    env: { ...mcp.launcher.env, ...sessionEnv },
  }]
}

type PublishedFrame = AgentWsFrame
  | ({ channel: 'agent-session:changed' } & AgentSessionChangedEvent)
  | AgentLifecycleFrame

// Three tags, one owner: the engine's own lines, the memory hand-off, and the webhook queue. The
// tag is what the reader greps for and the owner is what a sink files it under.
const log = createLogger('agents', 'agents')
const webhookLog = createLogger('agents:webhook', 'agents')

export { agentTurnInputText } from './runtimeContext'

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
  // acorn's own MCP server, read per session rather than captured, because the composition root sets it
  // and a test sets nothing. `null` means a session is offered no acorn tools, which is the honest
  // answer on a standalone node: it receives no service handshake, so it learns no staging directory.
  mcp?: () => { name: string; launcher: Launcher } | null
  secrets: SecretService
  standingContext?(taskId: string): Promise<string | null>
  currentUserId(): string | null
  registry?: AgentDriverRegistry
  // Any frame, not only the plugin's own: the core-named `agent-session:changed` goes out through the
  // same door (docs/plugins/events.md § Hearing a core event).
  publish?(frame: PublishedFrame): void
  startTerminalHandoff?(session: AgentSession): Promise<string>
  terminalHandoffRunning?(sessionId: string): Promise<boolean>
  // The owner's half of this plugin's hooks (docs/plugins/hooks.md § Hooks). Optional so a test can build an
  // engine with no host around it, and absent means nobody objects, which is also what an empty chain
  // means.
  hooks?: Pick<PluginHookRegistry, 'run'>
  /** `ctx.telemetry`, so a provider start and an agent turn are spans owned by this plugin
   *  (docs/managed-agents/session-events.md § What a session reports). Optional so a test can build an engine with
   *  no host around it. */
  telemetry?: PluginTelemetry
  /** How long a background child may go quiet before its roster row is settled to `idle`. Overridable
   *  only so a test does not have to wait out the real minute. */
  subagentQuietMs?: number
  /** How often the idle sweep runs. Overridable for the same reason. */
  idleSweepMs?: number
  /** How often provider processes are counted for telemetry. Overridable for the same reason. */
  footprintSampleMs?: number
  /** Confirms a suspected provider usage-limit error and returns the account's reset time. */
  usageLimitResetAt?(providerId: string): Promise<number | null>
  /** Test seam for the small delay after the provider's advertised reset boundary. */
  usageContinuationGraceMs?: number
}

export type WaitCondition = import('../../contract/wire').AgentWaitCondition
type RuntimeListener = (frame: AgentWsFrame) => void

// How long a providers answer is served without probing again. After this it is still served, and a
// probe runs behind it. Short, because signing in or installing a CLI should show within a visit.
const PROVIDER_FRESH_MS = 30_000
// How often idle provider processes are looked for. A process can outlive the owner's limit by up to
// this much, which is cheap next to the limits on offer.
const IDLE_SWEEP_MS = 5 * 60_000
// How long a measured folder size is reused. See diskFootprint().
const DISK_FOOTPRINT_MS = 30_000
// How often provider processes are counted for telemetry. Each count with a live session lists every
// process on the machine, so this stays slow. See armFootprintSample().
const FOOTPRINT_SAMPLE_MS = 60_000

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
  protected readonly mcp: () => { name: string; launcher: Launcher } | null
  // Every internal token this engine has handed to a provider child, so a leaked value can still be
  // scrubbed out of provider messages and transcripts. Bounded by the number of sessions started.
  protected readonly mintedSecrets: string[] = []
  /** The user's MCP servers (docs/mcp.md § Your own servers). Settings edits them through here too. */
  readonly mcpServers: AgentMcpServerStore
  protected readonly standingContext?: (taskId: string) => Promise<string | null>
  protected readonly currentUserId: () => string | null
  protected readonly registry: AgentDriverRegistry
  protected readonly publish?: (frame: PublishedFrame) => void
  protected readonly startTerminalHandoff?: (session: AgentSession) => Promise<string>
  protected readonly terminalHandoffRunning?: (sessionId: string) => Promise<boolean>
  protected readonly hooks?: Pick<PluginHookRegistry, 'run'>
  protected readonly telemetry?: PluginTelemetry
  protected readonly usageLimitResetAt?: (providerId: string) => Promise<number | null>
  protected readonly usageContinuationGraceMs: number
  // The span of every turn this process dispatched and has not seen settle, by turn id. In memory
  // for the reason `live` is: a turn only runs inside the node that started it, and a turn the
  // process died in the middle of reports nothing, which is the honest answer.
  protected readonly turnSpans = new Map<string, SpanHandle>()
  protected readonly processes: ProviderSessionLifecycle
  protected readonly queue: QueueCoordinator
  protected readonly subagentQuietMs: number
  // Armed with the first provider start and cleared by stop(). A timer over the live map rather than a
  // node schedule, because what it sweeps exists only in this process (docs/managed-agents/operations.md
  // § Idle stop).
  protected readonly idleSweepMs: number
  // Armed at construction when there is a host to report to, and cleared by stop().
  // The background pass over rows stored before the ledger fold, started by reconcile(). See there.
  protected ledgerCompaction: { controller: AbortController; done: Promise<void> } | null = null
  // The last folder measurement, shared by every caller inside DISK_FOOTPRINT_MS.
  protected diskMeasure: { at: number; bytes: Promise<{ attachmentsBytes: number; artifactsBytes: number }> } | null = null
  protected readonly listeners = new Set<RuntimeListener>()
  // The last row broadcast for each session, as `listedRow` reads it. See record().
  protected readonly sentRows = new Map<string, string>()
  protected readonly providerEvents: DurableAgentEventBuffer
  protected readonly eventMaterializer: ProviderEventMaterializer
  // The last probe answer, when that probe started, and which drivers it asked. See providers().
  protected providerCache: { probedAt: number; generation: number; descriptors: AgentProviderDescriptor[] } | null = null
  // The probe running now, which every caller that needs one joins.
  protected providerProbe: { generation: number; promise: Promise<AgentProviderDescriptor[]> } | null = null
  protected readonly shutdown = new AbortController()
  protected stopped = false
  private stopPromise: Promise<void> | null = null
  private readonly publicationCallbacks = new Set<Promise<void>>()

  constructor(options: AgentRuntimeOptions) {
    this.db = options.db
    this.core = options.core
    this.internalEnv = options.internalEnv
    this.mcp = options.mcp ?? (() => null)
    this.standingContext = options.standingContext
    this.currentUserId = options.currentUserId
    this.registry = options.registry ?? agentDriverRegistry
    this.publish = options.publish
    this.startTerminalHandoff = options.startTerminalHandoff
    this.terminalHandoffRunning = options.terminalHandoffRunning
    this.hooks = options.hooks
    this.telemetry = options.telemetry
    this.usageLimitResetAt = options.usageLimitResetAt
    this.usageContinuationGraceMs = options.usageContinuationGraceMs ?? USAGE_CONTINUATION_GRACE_MS
    this.subagentQuietMs = options.subagentQuietMs ?? SUBAGENT_QUIET_MS
    this.idleSweepMs = options.idleSweepMs ?? IDLE_SWEEP_MS
    this.store = new AgentStore(options.db, options.core, (frame) => { if (!this.stopped) this.publish?.(frame) })
    this.processes = new ProviderSessionLifecycle({
      registry: this.registry,
      taskRoot: (taskId) => this.core.tasks.requireRoot(taskId),
      workspaceId: (taskId) => this.core.tasks.workspaceId(taskId),
      hasProviderExecutionHistory: (sessionId) => this.store.hasProviderExecutionHistory(sessionId),
      scopedEnvironment: (session) => this.scopedProviderEnvironment(session),
      mcpServers: (session, env, signal) => this.providerMcpServers(session, env, signal),
      mcpUnavailable: (sessionId, names) => this.record(sessionId, null, {
        type: 'diagnostic', level: 'warning',
        message: `This session runs without ${names.join(', ')}: a stored secret could not be opened. Enter it again in Settings → MCP servers.`,
      }).then(() => undefined),
      event: (sessionId, generation, event) => this.onProviderEvent(sessionId, generation, event),
      closed: (sessionId, generation, attempt, error) => this.onProviderClosed(sessionId, generation, attempt, error),
      closeMessage: (error) => safeProviderMessage(error, 'Provider process closed.', this.mintedSecrets),
      startFailed: (sessionId, turnId, error) => this.onProviderStartFailed(sessionId, turnId, error),
      retirementFlush: async (sessionId) => {
        await this.providerEvents.flush(sessionId)
        await this.store.flushSearch(sessionId)
      },
      session: (sessionId) => this.store.requireSession(sessionId),
      idleSweep: async () => { await this.stopIdleSessions() },
      quietSweep: (sessionId) => this.quietSubagents(sessionId),
      footprintSample: () => this.sampleProcessFootprint(),
      callbackError: (kind, error) => log.warn(`${kind} sweep failed: ${describeError(error).message}`),
      started: (sessionId, reconnect) => this.telemetry?.startSpan('agent.session', {
        attrs: { seam: 'agent.session', 'session.id': sessionId, provider: this.processes.current(sessionId)?.providerId ?? null, reconnect },
      }),
      pump: () => { void this.pump() },
      shuttingDown: () => this.stopped,
    }, this.idleSweepMs, this.subagentQuietMs)
    this.queue = new QueueCoordinator({
      queuedHeads: () => this.store.queuedHeads(),
      getSession: (id) => this.store.getSession(id),
      requireSession: (id) => this.store.requireSession(id),
      nextQueuedTurn: (id) => this.store.nextQueuedTurn(id),
      limits: async () => {
        const userId = this.currentUserId()
        return userId
          ? this.readWhileRunning(() => readAgentConcurrency(this.core.prefs, userId)).catch((error: unknown) => {
            if (this.stopped) return defaultAgentConcurrency()
            throw error
          })
          : defaultAgentConcurrency()
      },
      occupancy: () => this.processes.occupancy(),
      live: (id) => this.processes.current(id),
      workspaceId: (taskId) => this.readWhileRunning(() => this.core.tasks.workspaceId(taskId)),
      stopLive: (id) => this.stopLive(id),
      ensureSession: (session, turnId, workspaceId) => this.processes.ensure(session, { turnId, workspaceId }),
      ownsSession: (generation) => this.processes.owns(generation),
      activate: (generation, turnId) => this.processes.activate(generation, turnId),
      release: (generation, turnId) => this.processes.release(generation, turnId),
      dispatch: (session, turn, generation) => this.dispatchQueuedTurn(session, turn, generation),
      shuttingDown: () => this.stopped,
    })
    this.attachments = new AgentAttachmentStore(options.db, options.dataDir, options.core)
    this.artifacts = new AgentArtifactStore(options.db, options.dataDir)
    // The redaction list grows as sessions start, rather than being computed once, because each session
    // mints its own scoped internal token (docs/security/credentials.md § Credential handling). #mintedSecrets
    // accumulates them and the materializer holds a live reference to the same array.
    this.eventMaterializer = new ProviderEventMaterializer(this.artifacts, this.mintedSecrets)
    this.webhooks = new AgentWebhookService(options.db, options.secrets, options.core)
    this.mcpServers = new AgentMcpServerStore(options.db, options.secrets)
    this.providerEvents = new DurableAgentEventBuffer((entry) => this.commitProviderEvent(entry))
    this.armFootprintSample(options.footprintSampleMs ?? FOOTPRINT_SAMPLE_MS)
  }

  subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * What each registered harness says about itself: installed, signed in, what it can do.
   *
   * A probe starts CLI binaries, so it takes a few hundred milliseconds and sometimes seconds. The
   * pane asks on every task visit. So the last answer is served at once, and a probe runs in the
   * background once it is older than PROVIDER_FRESH_MS. Only the first call after boot, a call after
   * a harness was added or removed, and `force` wait for one. `force` is the Refresh button, and the
   * re-check a refused start makes before it refuses (runtime.ts, delegation/service.ts).
   */
  async providers(force = false): Promise<AgentProviderDescriptor[]> {
    const cached = this.providerCache
    if (!force && cached && cached.generation === this.registry.generation) {
      if (Date.now() - cached.probedAt > PROVIDER_FRESH_MS) void this.probeProviders(false).catch(() => undefined)
      return this.withAdvertisedOptions(cached.descriptors)
    }
    return this.withAdvertisedOptions(await this.probeProviders(force))
  }

  /** Probes discover availability; connected sessions advertise the actual model and effort values.
   *  Read them on every request so a cached probe doesn't hide newly connected session options. */
  private async withAdvertisedOptions(descriptors: AgentProviderDescriptor[]): Promise<AgentProviderDescriptor[]> {
    const { sessions } = await this.store.listSessions({ limit: 50 })
    const advertised = new Map<string, AgentConfigOption[]>()
    for (const session of sessions) {
      const options = session.config.configOptions
      if (!advertised.has(session.providerId) && Array.isArray(options) && options.length) {
        advertised.set(session.providerId, options as AgentConfigOption[])
      }
    }
    if (!advertised.size) return descriptors
    return descriptors.map(provider => ({ ...provider, configOptions: advertised.get(provider.id) ?? provider.configOptions }))
  }

  /**
   * The provider `pick` finds, probed afresh when the served answer would refuse it. The served answer
   * can be minutes old, and a start must not be turned down for a CLI the owner has since installed or
   * signed in to.
   */
  async usableProvider(pick: (provider: AgentProviderDescriptor) => boolean): Promise<AgentProviderDescriptor | undefined> {
    const served = (await this.providers()).find(pick)
    this.shutdown.signal.throwIfAborted()
    if (served?.installed && served.authenticated !== false) return served
    return (await this.providers(true)).find(pick)
  }

  // A forced read starts its own probe, because one already running may have started before the
  // install or sign-in the caller is asking about. Any other caller joins the one running.
  protected probeProviders(force: boolean): Promise<AgentProviderDescriptor[]> {
    if (this.stopped) return Promise.reject(this.shutdown.signal.reason)
    const generation = this.registry.generation
    if (this.providerProbe?.generation === generation && !force) return this.providerProbe.promise
    const probedAt = Date.now()
    const driverIds = this.registry.providers()
    const wave = { generation, promise: null as unknown as Promise<AgentProviderDescriptor[]> }
    const probe = Promise.all(driverIds.map(async (providerId) => {
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
    })).then((descriptors) => {
      // An older probe that finishes last must not replace a newer answer.
      if (!this.stopped && (this.providerProbe === wave && this.registry.generation === generation)) {
        this.providerCache = { probedAt, generation, descriptors }
      }
      return descriptors
    }).finally(() => {
      if (this.providerProbe === wave) this.providerProbe = null
    })
    wave.promise = probe
    this.providerProbe = wave
    return probe
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
    // Nothing is streaming into a roster the previous process left behind, so any child still marked
    // active is one whose ending we will never hear. These sessions are not in `unsettledSessions`:
    // a backgrounded child leaves its parent `ready`, which is exactly why the row was stranded.
    for (const session of await this.store.sessionsWithActiveSubagents()) {
      for (const id of quietedSubagents(session.subagents, Date.now())) {
        await this.record(session.id, null, { type: 'subagent', subagent: { id, status: 'idle' } })
      }
    }
    await this.attachments.collectGarbage()
    await this.webhooks.reconcile()
    // Turns queued when the process last exited have nothing else to wake them: pump() runs on enqueue,
    // on a provider start, and when a turn settles, none of which happen on their own after a restart.
    // Not awaited, because draining spawns a provider child per session and boot waits on reconcile().
    void this.pump()
    this.compactLedgersInBackground()
  }

  // Tool calls and file changes stored before the ledger fold, put into the shape it writes
  // (./ledgerCompaction.ts). Startup repair rather than a schedule: it converges, and each session is
  // done once (docs/schedules.md § Limits). Not awaited, because the first
  // pass over a 1.3 GB database took about half a minute and boot waits on reconcile().
  protected compactLedgersInBackground(): void {
    if (this.stopped || this.ledgerCompaction) return
    const controller = new AbortController()
    const done = compactLedgers(this.db, {
      signal: controller.signal,
      onError: (sessionId, error) => log.warn(`could not compact session ${sessionId}: ${describeError(error).message}`),
    }).then((totals) => {
      if (totals.deleted || totals.rewritten) {
        log.info(`compacted ${totals.sessions} sessions: removed ${totals.deleted} superseded rows, rewrote ${totals.rewritten}`)
      }
    }, (error: unknown) => log.warn(`ledger compaction stopped: ${describeError(error).message}`))
    this.ledgerCompaction = { controller, done }
  }

  // Releases what this engine holds, in the order docs/managed-agents/operations.md § Operations and failure
  // describes. Called from the plugin's dispose (node/index.ts) before the database closes.
  stop(): Promise<void> {
    return this.stopPromise ??= this.stopEngine()
  }

  private async stopEngine(): Promise<void> {
    this.stopped = true
    this.shutdown.abort(new Error('The managed agent runtime is shutting down.'))
    this.processes.abortAndClearTimers()
    const queueDrain = this.queue.stop()
    // Stops at its next step. Awaited, because the database closes once stop() returns.
    this.ledgerCompaction?.controller.abort()
    await this.ledgerCompaction?.done
    this.ledgerCompaction = null
    let retirementFailure: unknown
    try {
      await this.processes.stopAll()
    } catch (error) {
      retirementFailure = error
    }
    await queueDrain
    await this.processes.joinCallbacks()
    await this.providerEvents.flushAll()
    await this.store.flushSearch()
    await Promise.allSettled([...this.publicationCallbacks])
    await this.webhooks.stop()
    this.turnSpans.clear()
    this.listeners.clear()
    this.eventMaterializer.clear()
    this.providerCache = null
    this.providerProbe = null
    if (retirementFailure) throw retirementFailure
  }

  holdSessionReadiness(sessionId: string): void {
    this.processes.holdReadiness(sessionId)
  }

  discardSessionReadinessHold(sessionId: string): void {
    this.processes.releaseReadiness(sessionId)
  }

  async completeSessionReadiness(sessionId: string): Promise<void> {
    this.processes.releaseReadiness(sessionId)
    if (this.stopped) return
    await this.record(sessionId, null, { type: 'session_state', state: 'ready' })
    void this.pump()
  }

  readWhileRunning<T>(query: () => Promise<T>): Promise<T> {
    this.shutdown.signal.throwIfAborted()
    return awaitWithSignal(query(), this.shutdown.signal)
  }

  ensureSession(session: AgentSession, admission?: { turnId: string; workspaceId: string }): Promise<ProviderGeneration> {
    return this.processes.ensure(session, admission)
  }

  get shutdownSignal(): AbortSignal { return this.shutdown.signal }
  get isStopped(): boolean { return this.stopped }
  currentSession(sessionId: string) { return this.processes.current(sessionId) }
  sessionSignal(generation: ProviderGeneration): AbortSignal { return this.processes.signal(generation) }
  hasLiveSession(sessionId: string): boolean { return this.processes.has(sessionId) }
  liveSessionIds(): string[] { return this.processes.ids() }
  withSessionHandle<T>(generation: ProviderGeneration, operation: (handle: AgentDriverSession) => Promise<T>): Promise<T> {
    return this.processes.withHandle(generation, operation)
  }
  withCurrentSessionHandle<T>(generation: ProviderGeneration, operation: (handle: AgentDriverSession) => Promise<T>): Promise<T | null> {
    return this.processes.withCurrentHandle(generation, operation)
  }
  sessionHandleIfPresent<T>(sessionId: string, operation: (handle: AgentDriverSession) => Promise<T>): Promise<T | null> {
    return this.processes.handleIfPresent(sessionId, operation)
  }
  flushProviderEvents(sessionId: string): Promise<void> { return this.providerEvents.flush(sessionId) }

  private scopedProviderEnvironment(session: AgentSession): Record<string, string> {
    // The session row is the authority for the tool ceiling across restarts.
    const env = {
      ...this.internalEnv({
        scope: 'task', taskId: session.taskId, sessionId: session.id,
        toolCeiling: persistedToolCeiling(session.config),
      }),
      ACORN_TASK_ID: session.taskId,
      ACORN_SESSION_ID: session.id,
    }
    for (const secret of secretEnvironmentValues(env)) if (!this.mintedSecrets.includes(secret)) this.mintedSecrets.push(secret)
    return env
  }

  private async providerMcpServers(
    session: AgentSession,
    env: Record<string, string>,
    signal: AbortSignal,
  ): Promise<{ servers: AgentDriverMcpServer[]; unavailable: string[] }> {
    const userMcp = await this.mcpServers.resolve(sessionMcpSelection(session.config), 'agent MCP server: start a session', signal)
    signal.throwIfAborted()
    for (const secret of userMcp.secrets) if (!this.mintedSecrets.includes(secret)) this.mintedSecrets.push(secret)
    return {
      servers: [...acornMcpServers(this.mcp(), session, env), ...userMcp.servers],
      unavailable: userMcp.unavailable,
    }
  }

  private async onProviderStartFailed(sessionId: string, turnId: string | null, error: unknown): Promise<void> {
    await this.record(sessionId, turnId, {
      type: 'error', code: 'provider_start_failed',
      message: safeProviderMessage(error, 'Provider session failed to start.', this.mintedSecrets),
      retryable: false,
    })
  }

  protected async onProviderEvent(sessionId: string, generation: ProviderGeneration, event: AgentDriverEvent): Promise<void> {
    if (event.type === 'session_state' && event.state === 'ready' && this.processes.isReadinessHeld(sessionId)) return
    const live = this.processes.current(sessionId)
    if (!live || live.closing || !this.processes.owns(generation)) return
    this.processes.heard(generation, !['session_state', 'session_metadata', 'diagnostic', 'error'].includes(event.type))
    const turnId = live.activeTurnId
    for (const normalized of await this.eventMaterializer.map(sessionId, turnId, event)) {
      if (!this.processes.owns(generation)) return
      if (turnId && await this.deferForUsageLimit(sessionId, turnId, generation, normalized)) continue
      if (!this.processes.owns(generation)) return
      await this.providerEvents.accept({ sessionId, turnId, event: normalized, generation })
    }
  }

  protected async deferForUsageLimit(
    sessionId: string,
    turnId: string,
    generation: ProviderGeneration,
    event: AgentNormalizedEvent,
  ): Promise<boolean> {
    if (!this.usageLimitResetAt || !mayBeUsageLimit(event)) return false
    const providerId = this.processes.current(sessionId)?.providerId
    if (!providerId) return false
    const resetAt = await awaitWithSignal(this.usageLimitResetAt(providerId).catch(() => null), this.processes.signal(generation))
    if (resetAt == null || !this.processes.owns(generation)) return false
    const resumeAt = Math.max(Date.now(), resetAt + this.usageContinuationGraceMs)
    // Any streamed answer fragments must precede the scheduler's diagnostic in the durable ledger.
    await this.providerEvents.flush(sessionId)
    if (!this.processes.owns(generation)) return false
    const turn = await this.store.deferTurnForUsageLimit(turnId, resumeAt, usageContinuationInput())
    if (!turn || !this.processes.owns(generation)) return false
    this.processes.clearActive(generation, turnId)
    this.endTurnSpan(turnId, 'requeued')
    this.emit({ channel: 'agent:turn', turn })
    await this.record(sessionId, turnId, {
      type: 'diagnostic',
      level: 'warning',
      message: usageContinuationMessage(resumeAt),
    })
    await this.record(sessionId, turnId, {
      type: 'session_state',
      state: 'ready',
      detail: 'Waiting for the provider usage window to reset.',
    })
    this.queue.wakeAtTime(resumeAt)
    void this.pump()
    return true
  }

  protected async commitProviderEvent({ sessionId, event, turnId, generation }: PendingAgentEvent): Promise<void> {
    const live = this.processes.current(sessionId)
    const settlesTurn = event.type === 'turn_completed' || event.type === 'error'
    if (settlesTurn) {
      if (live && (!generation || live.generation === generation)) this.processes.clearActive(live.generation, turnId ?? undefined)
      if (turnId && (!live || !generation || live.generation === generation)) {
        this.endTurnSpan(turnId, event.type === 'error' ? 'error' : 'completed')
      }
    }
    await this.record(sessionId, turnId, event)
    // The two things that change what the roster knows: a roster update, which is also how a child
    // first appears, and a child's own traffic. Each pushes the quiet sweep back, so a child that
    // keeps streaming keeps its row and a child that stops loses it a window later. Turn boundaries
    // are deliberately not on this list, and a session with no children never holds a timer.
    if (event.type === 'subagent' || eventSubagentId(event)) this.processes.armQuiet(sessionId)
    if (settlesTurn) {
      void this.pump()
    }
  }

  // A backgrounded child never reports that it finished. Its spawning `Agent` call returns a launch
  // receipt and then says nothing more about it, so the only way its row can ever end is if we infer
  // the end from silence (docs/managed-agents/subagents.md § Subagents). This is that inference, debounced:
  // every event the child produces pushes the sweep back, so it fires a full quiet window after the
  // last thing we heard. A real completion summary on a later turn still folds the row on to
  // `completed`, so nothing is lost by guessing `idle` first.
  protected async quietSubagents(sessionId: string): Promise<void> {
    if (this.stopped) return
    const session = await this.store.getSession(sessionId)
    if (!session || this.stopped) return
    const quieted = quietedSubagents(session.subagents, Date.now() - this.subagentQuietMs)
    for (const id of quieted) {
      // No turn id: the quieting is this engine's own inference, not something the turn that spawned
      // the child did, and that turn is usually long gone by now anyway.
      await this.record(sessionId, null, { type: 'subagent', subagent: { id, status: 'idle' } })
    }
    // A child that fell silent after this timer was armed is not stale yet, and nothing of its own is
    // coming to arm the next sweep, so do it here. A child still streaming re-arms with its traffic.
    const waiting = session.subagents.some((entry) =>
      entry.background && isActiveSubagent(entry) && !quieted.includes(entry.id))
    if (waiting) this.processes.armQuiet(sessionId)
  }

  protected async onProviderClosed(sessionId: string, generation: ProviderGeneration, attempt: number, error?: Error): Promise<void> {
    if (!this.processes.owns(generation)) return
    const message = safeProviderMessage(error, 'Provider process closed.', this.mintedSecrets)
    await this.store.interruptActiveTurn(sessionId, message)
    if (!this.processes.owns(generation)) return
    await this.store.expirePendingRequests(sessionId)
    if (!this.processes.owns(generation)) return
    const turnId = this.processes.takeActive(generation)
    if (turnId) this.endTurnSpan(turnId, 'interrupted')
    if (attempt >= 3) {
      await this.record(sessionId, null, { type: 'error', code: 'provider_disconnected', message, retryable: false })
      return
    }
    await this.record(sessionId, null, { type: 'session_state', state: 'reconnecting', detail: message })
  }

  pump(): Promise<void> {
    return this.queue.pump()
  }

  private async dispatchQueuedTurn(session: AgentSession, turn: AgentTurn, generation: ProviderGeneration): Promise<boolean> {
    this.processes.beginDispatch(generation)
    await this.store.dispatchTurn(turn.id)
    try {
      const input = turn.continuationInput ?? turn.input
      await this.record(session.id, turn.id, {
        type: 'user_message',
        text: agentTurnInputText({ ...turn, input }),
        ...(turn.continuationInput ? { automatic: true } : {}),
      })
      const attachments = Object.fromEntries((await Promise.all(
        [...new Set(input.flatMap((part) =>
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
      if (!this.processes.owns(generation)) return false
      await this.store.startTurn(turn.id)
      if (!this.processes.owns(generation)) return false
      this.beginTurnSpan(turn.id, session.id, session.providerId, turn.source)
      this.processes.sendTurn(generation, { turn, input, attachments },
        async (result) => {
          if (!this.processes.owns(generation)) return
          if (result.providerTurnRef) await this.store.setTurnProviderRef(turn.id, result.providerTurnRef)
        }, async (error) => {
          if (!this.processes.owns(generation) || this.processes.current(session.id)?.activeTurnId !== turn.id) return
          this.processes.clearActive(generation, turn.id)
          const failure = this.processes.driverFailure(generation, error)
          if (
            failure === 'safe_transient'
            && !this.processes.accepted(generation)
            && turn.attempt + 1 < 3
          ) {
            const message = safeProviderMessage(
              error,
              'Safe transient provider failure.',
              this.mintedSecrets,
            )
            // The same turn id starts again, so its first attempt's span has to close here or
            // the next attempt would replace an open handle in the map.
            this.endTurnSpan(turn.id, 'requeued')
            await this.store.requeueTransientTurn(turn.id, message)
            await this.record(session.id, turn.id, {
              type: 'diagnostic',
              level: 'warning',
              message: `Provider rejected the turn before accepting output; retrying (${turn.attempt + 2}/3).`,
            })
            await this.record(session.id, turn.id, {
              type: 'session_state',
              state: 'ready',
              detail: 'Safely retrying an undispatched provider turn.',
            })
            void this.pump()
            return
          }
          await this.providerEvents.accept({
            sessionId: session.id,
            turnId: turn.id,
            generation,
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
      this.processes.clearActive(generation, turn.id)
      await this.providerEvents.accept({
        sessionId: session.id,
        turnId: turn.id,
        generation,
        event: {
          type: 'error',
          code: 'turn_dispatch_failed',
          message: safeProviderMessage(error, 'Agent turn preparation failed.', this.mintedSecrets),
          retryable: false,
        },
      })
    }
    return true
  }

  async record(
    sessionId: string,
    turnId: string | null,
    event: AgentNormalizedEvent,
  ): Promise<AgentEventRecord> {
    const record = await this.store.recordEvent(sessionId, turnId, event)
    this.emit({ channel: 'agent:event', event: record })
    await this.emitProjection(sessionId, turnId, event)
    const session = await this.store.requireSession(sessionId)
    // Only when the event changed what the row says. Most events in a streamed reply move nothing on
    // the row except its sequence and clock, and the row runs 26 KB on average and up to 58 KB, mostly
    // the harness's skills list. Sent after every event, rows were about 96% of the agent socket's
    // bytes. The comparison skips `config` because of its size, so the one event that writes it,
    // `session_metadata`, always sends.
    if (event.type === 'session_metadata' || this.sentRows.get(sessionId) !== listedRow(session)) {
      this.emit({ channel: 'agent:session', session })
    }
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

  emit(frame: AgentWsFrame): void {
    if (this.stopped) return
    // Every broadcast row counts, whoever sent it, so record() compares against what clients last
    // heard. A read mark sends its own row with `attention: none`, and the next event that puts
    // `unread` back must be sent even though the last row record() sent also said `unread`.
    if (frame.channel === 'agent:session') this.sentRows.set(frame.session.id, listedRow(frame.session))
    else if (frame.channel === 'agent:deleted') this.sentRows.delete(frame.sessionId)
    // The socket gets the record without its search text; the node's own listeners keep it.
    this.publish?.(frame.channel === 'agent:event' ? { ...frame, event: clientEventRecord(frame.event) } : frame)
    for (const listener of this.listeners) listener(frame)
    this.trackPublication(this.webhooks.accept(frame).catch((error) => {
      webhookLog.warn(`failed to queue delivery: ${describeError(error).message}`)
    }))
    this.trackPublication(this.announce(frame).catch((error) => {
      log.warn(`failed to announce a session edge: ${describeError(error).message}`)
    }))
  }

  private trackPublication(work: Promise<void>): void {
    this.publicationCallbacks.add(work)
    const settled = () => this.publicationCallbacks.delete(work)
    void work.then(settled, settled)
  }

  // The webhook filter pointed inward: the same two edges, on a core channel every window and any
  // plugin's node half can hear. Third parties are otherwise blind to agent execution, since the
  // `agent:` prefix is the plugin's own.
  protected async announce(frame: AgentWsFrame): Promise<void> {
    const event = webhookEventKind(frame)
    if (!event || frame.channel !== 'agent:event') return
    const session = await this.store.requireSession(frame.event.sessionId)
    if (this.stopped) return
    this.publish?.({ channel: 'agent-session:changed', taskId: session.taskId, sessionId: session.id, event })
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

  forkContext(source: AgentSession): ReturnType<typeof buildForkContext> {
    return buildForkContext(this.store, source)
  }

  // Called when the task is archived (core:task-archiving, ../../node/index.ts). Each process holds a
  // provider CLI and its MCP servers, and nothing can prompt it until the task is restored. The
  // sessions stay. A restored task resumes them on the next prompt, the same way it does after a
  // restart, so this records what reconcile() records.
  async stopTaskSessions(taskId: string): Promise<void> {
    const stopping = this.processes.occupancy().filter((live) => live.taskId === taskId)
    await Promise.all(stopping.map(async (live) => {
      const sessionId = live.generation.sessionId
      const turnId = this.processes.takeActive(live.generation)
      // Cleared before the stop, so the send that fails when the process dies is not retried or
      // recorded as a provider failure.
      await this.stopLive(sessionId)
      await this.store.interruptActiveTurn(sessionId, 'The task was archived while the provider turn was active.')
      await this.store.expirePendingRequests(sessionId)
      if (turnId) this.endTurnSpan(turnId, 'interrupted')
      await this.record(sessionId, null, {
        type: 'session_state',
        state: 'stopped',
        detail: 'The provider process stopped when this task was archived. Restore the task and send a prompt to resume.',
      })
    }))
  }

  /**
   * Stops each provider process that has been idle past the owner's limit, and returns the sessions
   * it stopped. Each one holds an agent CLI and its MCP servers, about 450 MB, and nothing else stops
   * a session nobody prompts again. Read per sweep, so a change in Settings applies to the next one.
   */
  async stopIdleSessions(now = Date.now()): Promise<string[]> {
    if (this.stopped || !this.processes.ids().length) return []
    const userId = this.currentUserId()
    const { stopIdleAfterMinutes: minutes } = userId
      ? await this.readWhileRunning(() => readAgentSessionDefaults(this.core.prefs, userId)).catch((error: unknown) => {
        if (this.stopped) return defaultAgentSessionDefaults()
        throw error
      })
      : defaultAgentSessionDefaults()
    if (this.stopped || !minutes) return []
    const label = AGENT_IDLE_STOP_CHOICES.find((choice) => choice.minutes === minutes)?.label ?? `${minutes} minutes`
    return this.stopIdle(
      now - minutes * 60_000,
      `The provider process stopped after ${label} idle to free memory. Send a prompt to resume.`,
    )
  }

  /** Stop idle agents now, in Settings > Storage and memory: the sweep's rules with no time limit.
   *  It runs whatever the owner's limit is, Never included, because the owner asked for it. */
  async stopIdleSessionsNow(): Promise<string[]> {
    if (this.stopped || !this.processes.ids().length) return []
    return this.stopIdle(Date.now(), 'The provider process was stopped from Settings to free memory. Send a prompt to resume.')
  }

  /**
   * The live sessions, how many of them the idle rules would stop now, and the memory of their process
   * trees. `list` is a parameter so a test can hand it a fake table.
   */
  async processFootprint(
    list: () => Promise<ProcessRow[] | null> = async () => (await import('./footprint')).listProcesses(this.core.proc),
  ): Promise<{ live: number; idle: number; memoryBytes: number | null }> {
    const running = this.processes.occupancy().filter((live) => !live.stopping)
    const now = Date.now()
    let idle = 0
    for (const live of running) {
      if (await this.stoppableIdle(live.generation.sessionId, live.generation, now)) idle++
    }
    if (this.stopped) return { live: 0, idle: 0, memoryBytes: null }
    const pids = running.flatMap((live) => live.pid ? [live.pid] : [])
    const rows = running.length ? await list() : []
    return { live: running.length, idle, memoryBytes: rows ? (await import('./footprint')).processTreeBytes(rows, pids) : null }
  }

  /**
   * Report processFootprint() as three gauges owned by this plugin (docs/telemetry/diagnosis.md § Diagnosing
   * an unresponsive view). Skipped whole while nothing is collecting, because the count runs `ps`
   * through the process broker. Memory is left out when the table could not be read, rather than
   * reported as zero.
   */
  protected armFootprintSample(everyMs: number): void {
    if (this.telemetry) this.processes.armFootprintSample(everyMs)
  }

  private async sampleProcessFootprint(): Promise<void> {
    const telemetry = this.telemetry
    if (!telemetry?.enabled()) return
    const { live, idle, memoryBytes } = await this.processFootprint()
    if (this.stopped) return
    telemetry.gauge('agent.processes.live', live)
    telemetry.gauge('agent.processes.idle', idle)
    if (memoryBytes !== null) telemetry.gauge('agent.processes.memory', memoryBytes)
  }

  /** The size of the attachment and artifact folders. Walking them stats every file, so the answer is
   *  kept for DISK_FOOTPRINT_MS and a page polling every few seconds reuses it. */
  diskFootprint(now = Date.now()): Promise<{ attachmentsBytes: number; artifactsBytes: number }> {
    if (this.diskMeasure && now - this.diskMeasure.at < DISK_FOOTPRINT_MS) return this.diskMeasure.bytes
    const bytes = import('./footprint').then(async ({ directoryBytes }) => {
      const [attachmentsBytes, artifactsBytes] = await Promise.all([
        directoryBytes(this.attachments.root), directoryBytes(this.artifacts.root),
      ])
      return { attachmentsBytes, artifactsBytes }
    })
    this.diskMeasure = { at: now, bytes }
    return bytes
  }

  /**
   * The session, if the idle rules would stop its process: idle since `before` and nothing living inside
   * the process or waiting on it. That is a turn in flight or queued, a request the owner has not
   * answered, a background subagent still running, or a start in progress. Delegation reports and
   * workflow steps reach a session through enqueueTurn, which resumes a stopped one, so those need no
   * exception.
   */
  protected async stoppableIdle(sessionId: string, generation: ProviderGeneration, before: number): Promise<AgentSession | null> {
    if (!this.processes.idleCandidate(sessionId, generation, before)) return null
    const session = await this.store.getSession(sessionId)
    // `failed` too: a turn error leaves the process running, and the next prompt restarts a failed
    // session anyway.
    if (this.stopped || !session || !['ready', 'failed'].includes(session.runtimeState) || session.queuedTurns > 0) return null
    if (session.subagents.some(isActiveSubagent)) return null
    // The request rows are the authority here. `ready` is only what the last event projected.
    if ((await this.store.pendingRequests(sessionId)).length) return null
    return session
  }

  // The sweep and the Settings button, which differ only in `before` and in what the transcript says.
  protected async stopIdle(before: number, detail: string): Promise<string[]> {
    const stopped: string[] = []
    for (const live of this.processes.occupancy()) {
      const sessionId = live.generation.sessionId
      if (this.stopped) break
      const session = await this.stoppableIdle(sessionId, live.generation, before)
      if (!session) continue
      // Again, because a prompt could have arrived during the reads.
      if (!this.processes.idleCandidate(sessionId, live.generation, before)) continue
      // Marked before the record, so the dispatcher leaves this process alone while it is written.
      // Recorded before the stop, so a prompt that lands in between sees `stopped` and takes the resume
      // path rather than queueing behind a process that is about to exit. A failed session's state is
      // left as it is, so the failure still shows.
      if (!this.processes.markStopping(live.generation)) continue
      if (session.runtimeState === 'ready') {
        await this.record(sessionId, null, { type: 'session_state', state: 'stopped', detail })
      }
      if (this.processes.current(sessionId)?.generation === live.generation) await this.stopLive(sessionId)
      stopped.push(sessionId)
    }
    // A prompt that queued behind a stopping process has nothing else to wake it.
    if (stopped.length) void this.pump()
    return stopped
  }

  stopLive(sessionId: string): Promise<void> {
    return this.processes.stop(sessionId)
  }
}
