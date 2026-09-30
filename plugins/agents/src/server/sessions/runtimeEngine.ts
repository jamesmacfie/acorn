import type { CoreServices, InternalEnvFactory, Launcher, PluginDatabase, PluginHookRegistry, PluginTelemetry, SecretService, SpanHandle } from '@acorn/plugin-api/node'
import { agentProfileRegistry, createLogger, describeError } from '@acorn/plugin-api/node'
import type {
  AgentEventRecord,
  AgentNormalizedEvent,
  AgentProviderDescriptor,
  AgentSession,
  AgentSessionSnapshot,
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
import type { AgentDriver } from '../drivers/types'
import type { AgentDriverSession } from '../drivers/types'
import { AgentWebhookService, webhookEventKind } from '../webhookService'
import { AgentAttachmentStore } from './attachmentStore'
import { AgentArtifactStore } from './artifactStore'
import { DurableAgentEventBuffer, type PendingAgentEvent } from './durableEventBuffer'
import { compactLedgers } from './ledgerCompaction'
import { directoryBytes, listProcesses, processTreeBytes, type ProcessRow } from './footprint'
import { AgentStore } from './store'
import { clientEventRecord } from './rowMapping'
import {
  decideAgentCommand,
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
 * It leaves out four fields. `lastEventSeq` and `updatedAt` move with every event, and the client
 * reads the event frame for the one of them it needs live (../../client/sessions/managedStore.ts
 * § eventSeqs). A
 * subagent's `updatedAt` is the node's clock for quieting a silent child, and no client reads it. The
 * status that quieting changes is still compared. `config` is too large to compare per event, and
 * record() handles it separately.
 */
const listedRow = (session: AgentSession): string => JSON.stringify({
  ...session,
  config: null,
  lastEventSeq: 0,
  updatedAt: 0,
  subagents: session.subagents.map(({ updatedAt: _heardAt, ...entry }) => entry),
})

/**
 * acorn's own tool servers for one session, or none.
 *
 * Two doors exist and a harness gets one. Claude Code and Codex register acorn through their own CLI
 * (`claude mcp add`, `codex mcp add`), which their profile declares as `mcpRegistration`; telling them
 * again over the protocol would list every acorn tool twice. A contributed harness has no such command
 * and no manifest field for one, so the protocol is its only door. `mcpRegistration` is therefore the
 * test, rather than a new declaration: whoever already has a door keeps it.
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
  session: Pick<AgentSession, 'profileId'>,
  sessionEnv: Record<string, string>,
): AgentDriverMcpServer[] {
  if (!mcp) return []
  const profile = agentProfileRegistry.get(session.profileId)
  if (!profile || profile.mcpRegistration) return []
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

type LiveSession = {
  handle: AgentDriverSession | null
  startPromise: Promise<AgentDriverSession> | null
  activeTurnId: string | null
  // So archiving a task can find its processes without a read per live session.
  taskId: string
  workspaceId: string
  providerId: string
  stopping: boolean
  // The last provider event, dispatch, or turn settle. The idle sweep measures from here rather than
  // from the start, so a session in use is never the one it stops.
  lastActivityAt: number
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
  // acorn's own MCP server, read per session rather than captured, because the composition root sets it
  // and a test sets nothing. `null` means a session is offered no acorn tools, which is the honest
  // answer on a standalone node: it receives no service handshake, so it learns no staging directory.
  mcp?: () => { name: string; launcher: Launcher } | null
  secrets: SecretService
  currentUserId(): string | null
  registry?: AgentDriverRegistry
  // Any frame, not only the plugin's own: the core-named `agent-session:changed` goes out through the
  // same door (docs/plugins.md § Hearing a core event).
  publish?(frame: PublishedFrame): void
  startTerminalHandoff?(session: AgentSession): Promise<string>
  terminalHandoffRunning?(sessionId: string): Promise<boolean>
  // The owner's half of this plugin's hooks (docs/plugins.md § Hooks). Optional so a test can build an
  // engine with no host around it, and absent means nobody objects, which is also what an empty chain
  // means.
  hooks?: Pick<PluginHookRegistry, 'run'>
  /** `ctx.telemetry`, so a provider start and an agent turn are spans owned by this plugin
   *  (docs/managed-agents.md § What a session reports). Optional so a test can build an engine with
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

export type WaitCondition = 'ready' | 'attention' | 'turn_completed' | 'stopped'
type RuntimeListener = (frame: AgentWsFrame) => void

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000]
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
  // One pending quiet sweep per session, keyed by session id. A background child's traffic resets it,
  // so it fires only once that child has actually gone silent. Tracked for the same reason the
  // reconnect delays are: it must not outlive the engine that armed it.
  protected readonly quietTimers = new Map<string, ReturnType<typeof setTimeout>>()
  protected queueWakeTimer: ReturnType<typeof setTimeout> | null = null
  protected queueWakeAt: number | null = null
  protected readonly subagentQuietMs: number
  // Armed with the first provider start and cleared by stop(). A timer over the live map rather than a
  // node schedule, because what it sweeps exists only in this process (docs/managed-agents.md
  // § Operations and failure).
  protected idleSweepTimer: ReturnType<typeof setInterval> | null = null
  protected readonly idleSweepMs: number
  // Armed at construction when there is a host to report to, and cleared by stop().
  protected footprintTimer: ReturnType<typeof setInterval> | null = null
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
  protected providerCache: { probedAt: number; driverIds: string; descriptors: AgentProviderDescriptor[] } | null = null
  // The probe running now, which every caller that needs one joins.
  protected providerProbe: Promise<AgentProviderDescriptor[]> | null = null
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
    this.mcp = options.mcp ?? (() => null)
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
    this.store = new AgentStore(options.db, options.core, (frame) => this.publish?.(frame))
    this.attachments = new AgentAttachmentStore(options.db, options.dataDir, options.core)
    this.artifacts = new AgentArtifactStore(options.db, options.dataDir)
    // The redaction list grows as sessions start, rather than being computed once, because each session
    // mints its own scoped internal token (docs/security.md § Credential handling). #mintedSecrets
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
    if (!force && cached && cached.driverIds === this.registry.providers().join('\n')) {
      if (Date.now() - cached.probedAt > PROVIDER_FRESH_MS) void this.probeProviders(false).catch(() => undefined)
      return cached.descriptors
    }
    return this.probeProviders(force)
  }

  /**
   * The provider `pick` finds, probed afresh when the served answer would refuse it. The served answer
   * can be minutes old, and a start must not be turned down for a CLI the owner has since installed or
   * signed in to.
   */
  async usableProvider(pick: (provider: AgentProviderDescriptor) => boolean): Promise<AgentProviderDescriptor | undefined> {
    const served = (await this.providers()).find(pick)
    if (served?.installed && served.authenticated !== false) return served
    return (await this.providers(true)).find(pick)
  }

  // A forced read starts its own probe, because one already running may have started before the
  // install or sign-in the caller is asking about. Any other caller joins the one running.
  protected probeProviders(force: boolean): Promise<AgentProviderDescriptor[]> {
    if (this.providerProbe && !force) return this.providerProbe
    const probedAt = Date.now()
    const driverIds = this.registry.providers()
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
      if (!this.stopped && (!this.providerCache || this.providerCache.probedAt <= probedAt)) {
        this.providerCache = { probedAt, driverIds: driverIds.join('\n'), descriptors }
      }
      return descriptors
    }).finally(() => {
      if (this.providerProbe === probe) this.providerProbe = null
    })
    this.providerProbe = probe
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
  // done once (docs/schedules.md § What deliberately is not a schedule). Not awaited, because the first
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

  // Releases what this engine holds, in the order docs/managed-agents.md § Operations and failure
  // describes. Called from the plugin's dispose (node/index.ts) before the database closes.
  async stop(): Promise<void> {
    this.stopped = true
    for (const timer of this.reconnectTimers) clearTimeout(timer)
    this.reconnectTimers.clear()
    for (const timer of this.quietTimers.values()) clearTimeout(timer)
    this.quietTimers.clear()
    if (this.queueWakeTimer) clearTimeout(this.queueWakeTimer)
    this.queueWakeTimer = null
    this.queueWakeAt = null
    if (this.idleSweepTimer) clearInterval(this.idleSweepTimer)
    this.idleSweepTimer = null
    if (this.footprintTimer) clearInterval(this.footprintTimer)
    this.footprintTimer = null
    // Stops at its next step. Awaited, because the database closes once stop() returns.
    this.ledgerCompaction?.controller.abort()
    await this.ledgerCompaction?.done
    this.ledgerCompaction = null
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
    this.providerProbe = null
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
    const cwd = await this.core.tasks.requireRoot(session.taskId)
    const workspaceId = await this.core.tasks.workspaceId(session.taskId)
    const driver = this.registry.create(session.providerId)
    if (!driver) throw new Error(`Managed provider is not registered: ${session.providerId}`)
    const live: LiveSession = existing ?? {
      handle: null,
      startPromise: null,
      activeTurnId: null,
      taskId: session.taskId,
      workspaceId,
      providerId: session.providerId,
      stopping: false,
      lastActivityAt: Date.now(),
      reconnectAttempt: 0,
      acceptedResponse: false,
      driver,
    }
    live.workspaceId = workspaceId
    live.providerId = session.providerId
    live.driver = driver
    live.stopping = false
    this.live.set(session.id, live)
    this.armIdleSweep()
    const noProviderExecutionHistory = !(await this.store.hasProviderExecutionHistory(session.id))
    // Scoped to this session's task (docs/security.md § Credential handling). The credential cannot
    // drive another task's tools or read the owner's provider credentials.
    const sessionEnv = {
      ...this.internalEnv({
        scope: 'task',
        taskId: session.taskId,
        sessionId: session.id,
        // The session row is the authority across restarts. Workflow creation and later delegation
        // persist the effective intersection here before any provider process is started.
        toolCeiling: persistedToolCeiling(session.config),
      }),
      // The acorn MCP server lists no tools without a task ID. Claude Code and Codex start that server
      // from their own registration, so it only sees what the provider process inherits from here. The
      // node trusts the signed token for both values, never these.
      ACORN_TASK_ID: session.taskId,
      ACORN_SESSION_ID: session.id,
    }
    for (const secret of secretEnvironmentValues(sessionEnv)) if (!this.mintedSecrets.includes(secret)) this.mintedSecrets.push(secret)
    // The servers this session has switched on, resolved on every start because a harness keeps none of
    // them between processes. Their secrets join the redaction list for the same reason the token does.
    const userMcp = await this.mcpServers.resolve(sessionMcpSelection(session.config), 'agent MCP server: start a session')
    for (const secret of userMcp.secrets) if (!this.mintedSecrets.includes(secret)) this.mintedSecrets.push(secret)
    if (userMcp.unavailable.length) {
      await this.record(session.id, null, {
        type: 'diagnostic',
        level: 'warning',
        message: `This session runs without ${userMcp.unavailable.join(', ')}: a stored secret could not be opened. Enter it again in Settings → MCP servers.`,
      })
    }
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
      mcpServers: [...acornMcpServers(this.mcp(), session, sessionEnv), ...userMcp.servers],
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
      live.lastActivityAt = Date.now()
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

  protected async onProviderEvent(sessionId: string, event: AgentDriverEvent): Promise<void> {
    if (
      event.type === 'session_state'
      && event.state === 'ready'
      && this.readinessHolds.has(sessionId)
    ) return
    const live = this.live.get(sessionId)
    if (live) live.lastActivityAt = Date.now()
    if (live && !['session_state', 'session_metadata', 'diagnostic', 'error'].includes(event.type)) {
      live.acceptedResponse = true
    }
    const turnId = live?.activeTurnId ?? null
    for (const normalized of await this.eventMaterializer.map(sessionId, turnId, event)) {
      if (live && turnId && await this.deferForUsageLimit(sessionId, turnId, live, normalized)) continue
      await this.providerEvents.accept({ sessionId, turnId, event: normalized })
    }
  }

  protected async deferForUsageLimit(
    sessionId: string,
    turnId: string,
    live: LiveSession,
    event: AgentNormalizedEvent,
  ): Promise<boolean> {
    if (!this.usageLimitResetAt || !mayBeUsageLimit(event)) return false
    const resetAt = await this.usageLimitResetAt(live.providerId).catch(() => null)
    if (resetAt == null) return false
    const resumeAt = Math.max(Date.now(), resetAt + this.usageContinuationGraceMs)
    // Any streamed answer fragments must precede the scheduler's diagnostic in the durable ledger.
    await this.providerEvents.flush(sessionId)
    const turn = await this.store.deferTurnForUsageLimit(turnId, resumeAt, usageContinuationInput())
    if (!turn) return false
    live.activeTurnId = null
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
    this.armQueueWake(resumeAt)
    void this.pump()
    return true
  }

  protected async commitProviderEvent({ sessionId, event, turnId }: PendingAgentEvent): Promise<void> {
    const live = this.live.get(sessionId)
    const settlesTurn = event.type === 'turn_completed' || event.type === 'error'
    if (settlesTurn) {
      if (live) {
        live.activeTurnId = null
        live.lastActivityAt = Date.now()
      }
      if (turnId) this.endTurnSpan(turnId, event.type === 'error' ? 'error' : 'completed')
    }
    await this.record(sessionId, turnId, event)
    // The two things that change what the roster knows: a roster update, which is also how a child
    // first appears, and a child's own traffic. Each pushes the quiet sweep back, so a child that
    // keeps streaming keeps its row and a child that stops loses it a window later. Turn boundaries
    // are deliberately not on this list, and a session with no children never holds a timer.
    if (event.type === 'subagent' || eventSubagentId(event)) this.armSubagentQuiet(sessionId)
    if (settlesTurn) {
      void this.pump()
    }
  }

  // A backgrounded child never reports that it finished. Its spawning `Agent` call returns a launch
  // receipt and then says nothing more about it, so the only way its row can ever end is if we infer
  // the end from silence (docs/managed-agents.md § Subagents). This is that inference, debounced:
  // every event the child produces pushes the sweep back, so it fires a full quiet window after the
  // last thing we heard. A real completion summary on a later turn still folds the row on to
  // `completed`, so nothing is lost by guessing `idle` first.
  protected armSubagentQuiet(sessionId: string): void {
    const existing = this.quietTimers.get(sessionId)
    if (existing) clearTimeout(existing)
    if (this.stopped) return
    // Unref'd for the same reason the reconnect delays are: a node draining must not be held open by
    // a sweep nobody is waiting on.
    const timer = setTimeout(() => {
      this.quietTimers.delete(sessionId)
      void this.quietSubagents(sessionId)
        .catch((error: unknown) => log.warn(`subagent quiet sweep failed: ${describeError(error).message}`))
    }, this.subagentQuietMs)
    timer.unref?.()
    this.quietTimers.set(sessionId, timer)
  }

  protected async quietSubagents(sessionId: string): Promise<void> {
    if (this.stopped) return
    const session = await this.store.getSession(sessionId)
    if (!session) return
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
    if (waiting) this.armSubagentQuiet(sessionId)
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
          if (item.turn.notBefore != null && item.turn.notBefore > Date.now()) {
            this.armQueueWake(item.turn.notBefore)
            continue
          }
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
          live.lastActivityAt = Date.now()
          workspaceActive.set(live.workspaceId, (workspaceActive.get(live.workspaceId) ?? 0) + 1)
          providerActive.set(live.providerId, (providerActive.get(live.providerId) ?? 0) + 1)
          this.interactiveStreak = item.turn.source === 'workflow' ? 0 : this.interactiveStreak + 1
          await this.store.dispatchTurn(item.turn.id)
          try {
            const input = item.turn.continuationInput ?? item.turn.input
            await this.record(item.session.id, item.turn.id, {
              type: 'user_message',
              text: agentTurnInputText({ ...item.turn, input }),
              ...(item.turn.continuationInput ? { automatic: true } : {}),
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
            await this.store.startTurn(item.turn.id)
            this.beginTurnSpan(item.turn.id, item.session.id, live.providerId, item.turn.source)
            void live.handle.sendTurn({ turn: item.turn, input, attachments })
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

  protected armQueueWake(at: number): void {
    if (this.stopped) return
    if (this.queueWakeAt != null && this.queueWakeAt <= at) return
    if (this.queueWakeTimer) clearTimeout(this.queueWakeTimer)
    this.queueWakeAt = at
    this.queueWakeTimer = setTimeout(() => {
      this.queueWakeTimer = null
      this.queueWakeAt = null
      void this.pump()
    }, Math.max(0, at - Date.now()))
    this.queueWakeTimer.unref?.()
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

  protected emit(frame: AgentWsFrame): void {
    // Every broadcast row counts, whoever sent it, so record() compares against what clients last
    // heard. A read mark sends its own row with `attention: none`, and the next event that puts
    // `unread` back must be sent even though the last row record() sent also said `unread`.
    if (frame.channel === 'agent:session') this.sentRows.set(frame.session.id, listedRow(frame.session))
    else if (frame.channel === 'agent:deleted') this.sentRows.delete(frame.sessionId)
    // The socket gets the record without its search text; the node's own listeners keep it.
    this.publish?.(frame.channel === 'agent:event' ? { ...frame, event: clientEventRecord(frame.event) } : frame)
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

  // Called when the task is archived (core:task-archiving, ../../node/index.ts). Each process holds a
  // provider CLI and its MCP servers, and nothing can prompt it until the task is restored. The
  // sessions stay. A restored task resumes them on the next prompt, the same way it does after a
  // restart, so this records what reconcile() records.
  async stopTaskSessions(taskId: string): Promise<void> {
    const stopping = [...this.live].filter(([, live]) => live.taskId === taskId)
    await Promise.all(stopping.map(async ([sessionId, live]) => {
      const turnId = live.activeTurnId
      // Cleared before the stop, so the send that fails when the process dies is not retried or
      // recorded as a provider failure.
      live.activeTurnId = null
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

  protected armIdleSweep(): void {
    if (this.idleSweepTimer || this.stopped) return
    // Unref'd like the other timers here: nothing should hold a draining node open for a sweep.
    this.idleSweepTimer = setInterval(() => {
      void this.stopIdleSessions()
        .catch((error: unknown) => log.warn(`idle sweep failed: ${describeError(error).message}`))
    }, this.idleSweepMs)
    this.idleSweepTimer.unref?.()
  }

  // Idle as far as this process can tell without a read: started, not stopping, no turn in flight,
  // no start still being set up, and nothing heard from the provider since `before`.
  protected idleLive(sessionId: string, live: LiveSession, before: number): boolean {
    return live.handle != null
      && !live.startPromise
      && !live.stopping
      && !live.activeTurnId
      && !this.readinessHolds.has(sessionId)
      && live.lastActivityAt <= before
  }

  /**
   * Stops each provider process that has been idle past the owner's limit, and returns the sessions
   * it stopped. Each one holds an agent CLI and its MCP servers, about 450 MB, and nothing else stops
   * a session nobody prompts again. Read per sweep, so a change in Settings applies to the next one.
   */
  async stopIdleSessions(now = Date.now()): Promise<string[]> {
    if (this.stopped || !this.live.size) return []
    const userId = this.currentUserId()
    const { stopIdleAfterMinutes: minutes } = userId
      ? await readAgentSessionDefaults(this.core.prefs, userId)
      : defaultAgentSessionDefaults()
    if (!minutes) return []
    const label = AGENT_IDLE_STOP_CHOICES.find((choice) => choice.minutes === minutes)?.label ?? `${minutes} minutes`
    return this.stopIdle(
      now - minutes * 60_000,
      `The provider process stopped after ${label} idle to free memory. Send a prompt to resume.`,
    )
  }

  /** Stop idle agents now, in Settings > Storage and memory: the sweep's rules with no time limit.
   *  It runs whatever the owner's limit is, Never included, because the owner asked for it. */
  async stopIdleSessionsNow(): Promise<string[]> {
    if (this.stopped || !this.live.size) return []
    return this.stopIdle(Date.now(), 'The provider process was stopped from Settings to free memory. Send a prompt to resume.')
  }

  /**
   * The live sessions, how many of them the idle rules would stop now, and the memory of their process
   * trees. `list` is a parameter so a test can hand it a fake table.
   */
  async processFootprint(
    list: () => Promise<ProcessRow[] | null> = () => listProcesses(this.core.proc),
  ): Promise<{ live: number; idle: number; memoryBytes: number | null }> {
    const running = [...this.live].filter(([, live]) => !live.stopping)
    const now = Date.now()
    let idle = 0
    for (const [sessionId, live] of running) {
      if (await this.stoppableIdle(sessionId, live, now)) idle++
    }
    const pids = running.flatMap(([, live]) => (live.handle?.pid ? [live.handle.pid] : []))
    const rows = running.length ? await list() : []
    return { live: running.length, idle, memoryBytes: rows ? processTreeBytes(rows, pids) : null }
  }

  /**
   * Report processFootprint() as three gauges owned by this plugin (docs/telemetry.md § Diagnosing
   * an unresponsive view). Skipped whole while nothing is collecting, because the count runs `ps`
   * through the process broker. Memory is left out when the table could not be read, rather than
   * reported as zero.
   */
  protected armFootprintSample(everyMs: number): void {
    const telemetry = this.telemetry
    if (!telemetry || this.footprintTimer) return
    this.footprintTimer = setInterval(() => {
      if (this.stopped || !telemetry.enabled()) return
      void this.processFootprint().then(({ live, idle, memoryBytes }) => {
        if (this.stopped) return
        telemetry.gauge('agent.processes.live', live)
        telemetry.gauge('agent.processes.idle', idle)
        if (memoryBytes !== null) telemetry.gauge('agent.processes.memory', memoryBytes)
      }).catch((error: unknown) => log.warn(`process footprint failed: ${describeError(error).message}`))
    }, everyMs)
    // Unref'd like the other timers here.
    this.footprintTimer.unref?.()
  }

  /** The size of the attachment and artifact folders. Walking them stats every file, so the answer is
   *  kept for DISK_FOOTPRINT_MS and a page polling every few seconds reuses it. */
  diskFootprint(now = Date.now()): Promise<{ attachmentsBytes: number; artifactsBytes: number }> {
    if (this.diskMeasure && now - this.diskMeasure.at < DISK_FOOTPRINT_MS) return this.diskMeasure.bytes
    const bytes = Promise.all([directoryBytes(this.attachments.root), directoryBytes(this.artifacts.root)])
      .then(([attachmentsBytes, artifactsBytes]) => ({ attachmentsBytes, artifactsBytes }))
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
  protected async stoppableIdle(sessionId: string, live: LiveSession, before: number): Promise<AgentSession | null> {
    if (!this.idleLive(sessionId, live, before)) return null
    const session = await this.store.getSession(sessionId)
    // `failed` too: a turn error leaves the process running, and the next prompt restarts a failed
    // session anyway.
    if (!session || !['ready', 'failed'].includes(session.runtimeState) || session.queuedTurns > 0) return null
    if (session.subagents.some(isActiveSubagent)) return null
    // The request rows are the authority here. `ready` is only what the last event projected.
    if ((await this.store.pendingRequests(sessionId)).length) return null
    return session
  }

  // The sweep and the Settings button, which differ only in `before` and in what the transcript says.
  protected async stopIdle(before: number, detail: string): Promise<string[]> {
    const stopped: string[] = []
    for (const [sessionId, live] of [...this.live]) {
      const session = await this.stoppableIdle(sessionId, live, before)
      if (!session) continue
      // Again, because a prompt could have arrived during the reads.
      if (this.live.get(sessionId) !== live || !this.idleLive(sessionId, live, before)) continue
      // Marked before the record, so the dispatcher leaves this process alone while it is written.
      // Recorded before the stop, so a prompt that lands in between sees `stopped` and takes the resume
      // path rather than queueing behind a process that is about to exit. A failed session's state is
      // left as it is, so the failure still shows.
      live.stopping = true
      if (session.runtimeState === 'ready') {
        await this.record(sessionId, null, { type: 'session_state', state: 'stopped', detail })
      }
      if (this.live.get(sessionId) === live) await this.stopLive(sessionId)
      stopped.push(sessionId)
    }
    // A prompt that queued behind a stopping process has nothing else to wake it.
    if (stopped.length) void this.pump()
    return stopped
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
