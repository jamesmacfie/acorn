import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { awaitWithSignal } from '../processes/startCancellation'
import { AFTER_TOOL_HOOK, BEFORE_TOOL_HOOK, LOOP_HOOK_ROUTE, LOOP_HOOK_VERSION } from '../../contract/loopHook.ts'
import type {
  CompiledCoreServices,
  InternalEnvFactory,
  Launcher,
  PluginDatabase,
  PluginHookRegistry,
  PluginTelemetry,
  SecretService,
  SpanHandle,
} from '@acorn/plugin-api/node'
import {
  acornFileGuard,
  acornLoopHook,
  agentProfileRegistry,
  clientCustodyDirs,
  createLogger,
  deliverableSkills,
  describeError,
  recordSkillDelivery,
} from '@acorn/plugin-api/node'
import type {
  AgentEventRecord,
  AgentInputPart,
  AgentNormalizedEvent,
  AgentSession,
  AgentTurn,
} from '../../contract/wire.ts'
import type { EnqueueAgentTurnInput } from '../../shared/schemas'
import type { AgentDriverEvent, AgentDriverMcpServer, AgentDriverTurnOptions } from '../drivers/types'
import type { SkillReport } from '../drivers/skillIndex'
import { AgentMcpServerStore } from '../mcpServerStore'
import { AgentAccounts, agentAccountsRoot, linkSharedSettings, linkSharedSkills } from '../accounts'
import { sessionAccount } from '../../shared/accounts'
import type { McpReviewManager } from '../mcpReviewManager'
import { sessionMcpSelection } from '../../shared/mcpServers'
import { parseToolCeiling } from '@acorn/protocol/toolPolicy.ts'
import { delegatedToolCeiling } from '../delegation/policy'
import { defaultAgentConcurrency } from '../../shared/concurrency'
import { persistedAttendance, sessionAttendance, type TurnAttendanceContext } from './attendance'
import { readAgentConcurrency } from '../concurrencyStore'
import { defaultAgentSessionDefaults } from '../../shared/sessionDefaults'
import { readAgentSessionDefaults } from '../sessionDefaultsStore'
import { agentDriverRegistry, type AgentDriverRegistry } from '../drivers/registry'
import { safeProviderMessage } from '../drivers/diagnostics'
import { AgentWebhookService } from '../webhookService'
import { AgentAttachmentStore } from './attachmentStore'
import { AgentArtifactStore } from './artifactStore'
import { DurableAgentEventBuffer, type PendingAgentEvent } from './durableEventBuffer'
import { compactLedgers } from './ledgerCompaction'
import { AgentStore, type EnqueueTurnOutcome } from './store'
import { QueueCoordinator } from './queueCoordinator'
import { ProviderSessionLifecycle, type ProviderGeneration } from './providerSessionLifecycle'
import type { AgentDriverSession } from '../drivers/types'
import { eventSubagentId, isActiveSubagent, quietedSubagents, SUBAGENT_QUIET_MS } from './stateMachine'
import { ProviderEventMaterializer } from './providerEventMaterializer'
import type { RepeatedToolCallWarnings } from './repeatedToolCalls'
import type { TurnFactsWriter } from './turnFactsWriter'
import type { AgentLifecyclePublisher } from '../../contract/lifecycle'
import type { CommandScope } from './commandLifecycle'
import type { PluginNotice } from '@acorn/protocol/notices.ts'
import { agentTurnInputText, buildForkContext } from './runtimeContext'
import type { InstructionAdmission } from './instructionAdmission'
import { InstructionAdmissionError } from './instructionAdmissionError'
import type { SessionGoalGeneration } from './sessionGoalGeneration'
import {
  mayBeUsageLimit,
  USAGE_CONTINUATION_GRACE_MS,
  usageContinuationInput,
  usageContinuationMessage,
} from './usageContinuation'
import { assertBoundedJson, MAX_AGENT_POLICY_BYTES, validateAgentInputFiles } from './inputValidation'
import { LazyService } from './lazyService'
import { SessionFrames, type PublishedFrame } from './sessionFrames'
import { ProcessUpkeep } from './processUpkeep'

/**
 * acorn's own tool servers for one session, or none.
 *
 * ACP harnesses with CLI registration use that registration; other ACP harnesses receive a protocol
 * declaration. Managed Codex always receives a declaration under the registered server's name, which
 * overrides its config-file entry. Codex filters inherited MCP environment variables, so registration
 * alone drops the signed task context and leaves the server with no tools.
 *
 * A session on an account receives a declaration too. The CLI registers into the default config folder,
 * and an account has its own folder that registration never writes to (docs/managed-agents/accounts.md).
 *
 * An unregistered profile gets nothing either. The session could not have started without one, so this
 * is a broken state rather than a case, and the conservative answer is not to hand a credential to it.
 *
 * The environment is spelled out rather than inherited. An agent is free to scrub credential-shaped
 * names out of what it passes its own children, and a stdio MCP server that loses `ACORN_API_TOKEN` or
 * `ACORN_TASK_ID` fails every call. The token, not the ids, is what the node trusts for the task, the
 * session, and the tool ceiling (docs/mcp.md § Launch environment).
 */
export function acornMcpServers(
  mcp: { name: string; launcher: Launcher } | null,
  session: Pick<AgentSession, 'profileId' | 'driverKind' | 'config'>,
  sessionEnv: Record<string, string>,
): AgentDriverMcpServer[] {
  if (!mcp) return []
  const profile = agentProfileRegistry.get(session.profileId)
  if (!profile) return []
  const registered =
    profile.mcpRegistration && session.driverKind !== 'codex-app-server' && !sessionAccount(session.config)
  if (registered) return []
  return [
    {
      transport: 'stdio',
      name: mcp.name,
      command: mcp.launcher.command,
      args: mcp.launcher.args,
      env: { ...mcp.launcher.env, ...sessionEnv },
    },
  ]
}

// The tag is what the reader greps for and the owner is what a sink files it under.

/** A dispatched turn's span and the waits inside it. Times are `performance.now()`. */
type TurnSpan = {
  span: SpanHandle
  startedAt: number
  firstOutputMs?: number
  approvalWaitMs: number
  /** Permission asks still waiting on a person, by request id, with when each was asked. */
  waiting: Map<string, number>
}
const log = createLogger('agents', 'agents')

export type AgentRuntimeOptions = {
  // This plugin's own SQLite file, not core's handle. Everything the engine reads and writes is in the
  // `agent_*` tables.
  db: PluginDatabase
  dataDir: string
  core: CompiledCoreServices
  internalEnv: InternalEnvFactory
  // acorn's own MCP server, read per session rather than captured, because the composition root sets it
  // and a test sets nothing. `null` means a session is offered no acorn tools, which is the honest
  // answer on a standalone node: it receives no service handshake, so it learns no staging directory.
  mcp?: () => { name: string; launcher: Launcher } | null
  secrets: SecretService
  standingContext?(taskId: string): Promise<string | null>
  /** The memory index as of now, read before each dispatched turn. `null` when live updates are off. */
  currentStandingContext?(taskId: string): Promise<string | null>
  currentUserId(): string | null
  registry?: AgentDriverRegistry
  publish?(frame: PublishedFrame): void
  startTerminalHandoff?(session: AgentSession): Promise<string>
  terminalHandoffRunning?(sessionId: string): Promise<boolean>
  /** Opens a shell in a task's terminal and answers its terminal session id. Absent when the Node runs
   *  no terminals. */
  openTerminal?(input: { taskId: string; title: string; command: string; env: Record<string, string> }): Promise<string>
  // The owner's half of this plugin's hooks (docs/plugins/hooks.md § Hooks). Optional so a test can build an
  // engine with no host around it, and absent means nobody objects, which is also what an empty chain
  // means.
  hooks?: Pick<PluginHookRegistry, 'run' | 'handlers'>
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
  /** Confirms a suspected provider usage-limit error and returns the account's reset time. A null
   *  `account` is the harness's default login. */
  usageLimitResetAt?(providerId: string, account: string | null): Promise<number | null>
  /** The Node's extra harness logins. Defaults to the folder under `dataDir`; the composition root
   *  passes its own so the usage service reads the same one. */
  accounts?: AgentAccounts
  /** Test seam for the small delay after the provider's advertised reset boundary. */
  usageContinuationGraceMs?: number
  /** `ctx.events.notice`, for a bell row when an agent repeats a tool call. Optional so a test can build
   *  an engine with no host around it. */
  notice?(notice: PluginNotice): void
}

export type WaitCondition = import('../../contract/wire').AgentWaitCondition

// How often idle provider processes are looked for. A process can outlive the owner's limit by up to
// this much, which is cheap next to the limits on offer.
const IDLE_SWEEP_MS = 5 * 60_000
// How often provider processes are counted for telemetry. Each count with a live session lists every
// process on the machine, so this stays slow. See ProcessUpkeep.sampleProcessFootprint().
const FOOTPRINT_SAMPLE_MS = 60_000

const secretEnvironmentValues = (env: Record<string, string>): string[] =>
  Object.entries(env).flatMap(([key, value]) =>
    /(?:TOKEN|SECRET|PASSWORD|AUTH|COOKIE|KEY)/i.test(key) && value ? [value] : [],
  )

/** A `before-send` handler refused the turn. Its own class, so a caller can answer a refusal rather than fail. */
export class TurnVetoedError extends Error {}

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

const persistedToolCeiling = (config: Record<string, unknown>) => {
  if (!Object.prototype.hasOwnProperty.call(config, 'toolCeiling')) return undefined
  // A corrupt or unrecognized persisted ceiling must remove every tool, never become an unlimited
  // token. Absence remains the ordinary interactive-session behavior: no additional ceiling.
  return parseToolCeiling(config.toolCeiling) ?? { allow: [] }
}

/**
 * The managed-agent runtime's internal machine: provider process supervision, event durability, and
 * scheduling. Nothing outside this folder talks to it. ManagedAgentRuntime builds it, and exposes the
 * collaborators below that callers need.
 */
export class ManagedAgentEngine {
  readonly store: AgentStore
  readonly attachments: AgentAttachmentStore
  readonly artifacts: AgentArtifactStore
  readonly webhooks: AgentWebhookService
  readonly accounts: AgentAccounts
  private readonly registry: AgentDriverRegistry
  /** The user's MCP servers (docs/mcp.md § Your own servers). Settings edits them through here too. */
  readonly mcpServers: AgentMcpServerStore
  /** Who hears a session frame. */
  readonly frames: SessionFrames
  /** Idle and task-archive stops, and what the provider processes hold. */
  readonly upkeep: ProcessUpkeep
  /** The instruction check every queued turn passes before its driver send. */
  readonly instructionAdmission: LazyService<InstructionAdmission>
  /** Tool-catalogue reviews for MCP servers that ask for one. */
  readonly mcpReviews: LazyService<McpReviewManager>
  readonly goals: LazyService<SessionGoalGeneration>
  readonly processes: ProviderSessionLifecycle
  // Each start's native skill folder, `<session id>/<generation>`.
  readonly skillFolders: string
  private readonly db: PluginDatabase
  private readonly core: CompiledCoreServices
  private readonly internalEnv: InternalEnvFactory
  private readonly mcp: () => { name: string; launcher: Launcher } | null
  // Every internal token this engine has handed to a provider child, so a leaked value can still be
  // scrubbed out of provider messages and transcripts. Bounded by the number of sessions started.
  private readonly mintedSecrets: string[] = []
  private readonly currentUserId: () => string | null
  private readonly hooks?: Pick<PluginHookRegistry, 'run' | 'handlers'>
  private readonly telemetry?: PluginTelemetry
  private readonly usageLimitResetAt?: AgentRuntimeOptions['usageLimitResetAt']
  private readonly currentStandingContext?: AgentRuntimeOptions['currentStandingContext']
  private readonly usageContinuationGraceMs: number
  private readonly notice?: (notice: PluginNotice) => void
  // Loaded on the first tool call that has input.
  private repeatedToolCalls: Promise<RepeatedToolCallWarnings> | null = null
  // The span of every turn this process dispatched and has not seen settle, by turn id. In memory
  // for the reason `live` is: a turn only runs inside the node that started it, and a turn the
  // process died in the middle of reports nothing, which is the honest answer.
  private readonly turnSpans = new Map<string, TurnSpan>()
  private readonly queue: QueueCoordinator
  private readonly subagentQuietMs: number
  // The background passes over stored history, started by the runtime's reconcile(). See
  // repairHistoryInBackground().
  private historyRepair: { controller: AbortController; done: Promise<void> } | null = null
  // Loaded on the first turn that settles.
  private turnFacts: Promise<TurnFactsWriter> | null = null
  private readonly publishLifecycle: AgentLifecyclePublisher
  private readonly providerEvents: DurableAgentEventBuffer
  private readonly eventMaterializer: ProviderEventMaterializer
  private readonly shutdown = new AbortController()
  private readonly instructionScans = new Map<string, AbortController>()
  // The transcript text of each turn being steered, by turn id, read when its driver says the agent
  // took it. Each steer's driver call runs past the request that started it, so stop() waits on them.
  private readonly steeredText = new Map<string, string>()
  private readonly steers = new Set<Promise<void>>()
  private stopped = false
  private stopPromise: Promise<void> | null = null

  constructor(options: AgentRuntimeOptions) {
    this.db = options.db
    this.core = options.core
    this.internalEnv = options.internalEnv
    this.mcp = options.mcp ?? (() => null)
    this.currentUserId = options.currentUserId
    this.hooks = options.hooks
    this.telemetry = options.telemetry
    this.usageLimitResetAt = options.usageLimitResetAt
    this.currentStandingContext = options.currentStandingContext
    this.usageContinuationGraceMs = options.usageContinuationGraceMs ?? USAGE_CONTINUATION_GRACE_MS
    this.notice = options.notice
    this.subagentQuietMs = options.subagentQuietMs ?? SUBAGENT_QUIET_MS
    this.skillFolders = join(options.dataDir, 'agent-skills')
    this.accounts = options.accounts ?? new AgentAccounts(agentAccountsRoot(options.dataDir))
    this.registry = options.registry ?? agentDriverRegistry
    const publish = options.publish
    this.publishLifecycle = (frame) => {
      if (!this.stopped) publish?.(frame)
    }
    this.store = new AgentStore(options.db, options.core, this.publishLifecycle, (turnId) => {
      this.turnFactsWriter()
        .then((writer) => {
          if (!this.stopped) writer.enqueue(turnId)
        })
        .catch((error: unknown) => log.warn(`could not load the turn facts writer: ${describeError(error).message}`))
    })
    this.processes = new ProviderSessionLifecycle(
      {
        registry: this.registry,
        taskRoot: (taskId) => this.core.tasks.requireRoot(taskId),
        workspaceId: (taskId) => this.core.tasks.workspaceId(taskId),
        hasProviderExecutionHistory: (sessionId) => this.store.hasProviderExecutionHistory(sessionId),
        scopedEnvironment: (session, sandboxed) => this.scopedProviderEnvironment(session, sandboxed),
        mcpServers: (session, env, signal) => this.providerMcpServers(session, env, signal),
        // Loaded on the first start rather than at boot, like the rest of a start's preparation. A driver
        // with its own skill support gets a folder per start, which the lifecycle removes when it's done.
        skills: async (session, generation, native) =>
          (await import('../drivers/skillIndex')).prepareSkillStart(await deliverableSkills(options.dataDir), {
            folder: native ? join(this.skillFolders, session.id, String(generation.number)) : null,
            lastTold: session.config.skillIndex,
          }),
        skillsDelivered: (sessionId, report) => this.skillsDelivered(sessionId, report),
        // Only the points somebody handles, read at every start and resume like the skills.
        loopHooks: async () => {
          const bridge = acornLoopHook()
          if (!bridge || !this.hooks) return null
          const [before, after] = await Promise.all(
            [BEFORE_TOOL_HOOK.id, AFTER_TOOL_HOOK.id].map((id) => this.hooks!.handlers(id)),
          )
          if (!before!.length && !after!.length) return null
          return {
            command: bridge.command,
            args: [...bridge.args, LOOP_HOOK_ROUTE, LOOP_HOOK_VERSION],
            beforeTool: before!.length > 0,
            afterTool: after!.length > 0,
          }
        },
        accountHome: (session) => this.accountHome(session),
        // The person's switch on Settings > Security and backup (docs/managed-agents/read-block.md).
        readBlockOn: async () => {
          const userId = this.currentUserId()
          return !!userId && (await readAgentSessionDefaults(this.core.prefs, userId)).blockDataRootReads
        },
        readBlock: async (input) => {
          // Claude's own file tools run outside its sandbox, so a blocked session doesn't start without
          // the guard that checks them.
          const fileGuard = acornFileGuard()
          if (!fileGuard)
            throw new Error(
              "This Node can't keep an agent's file tools out of Acorn's data folder, because it has no file guard program.",
            )
          const { sessionId, ...start } = input
          // Made now so the block keeps it open. A file copied in later is readable through the folder.
          const attachments = this.attachments.sessionFolder(sessionId)
          await mkdir(attachments, { recursive: true })
          return (await import('../drivers/readBlock')).dataRootReadBlock({
            dataDir: options.dataDir,
            clientDirs: clientCustodyDirs(options.dataDir),
            fileGuard,
            attachments,
            ...start,
          })
        },
        mcpUnavailable: (sessionId, names) =>
          this.record(sessionId, null, {
            type: 'diagnostic',
            level: 'warning',
            message: `This session runs without ${names.join(', ')}. Check consent, stored credentials, and review availability in Settings → MCP servers.`,
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
        idleSweep: async () => {
          await this.upkeep.stopIdleSessions()
        },
        quietSweep: (sessionId) => this.quietSubagents(sessionId),
        footprintSample: () => this.upkeep.sampleProcessFootprint(),
        callbackError: (kind, error) => log.warn(`${kind} sweep failed: ${describeError(error).message}`),
        telemetry: this.telemetry,
        pump: () => {
          void this.pump()
        },
        shuttingDown: () => this.stopped,
      },
      options.idleSweepMs ?? IDLE_SWEEP_MS,
      this.subagentQuietMs,
    )
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
    this.mcpServers = new AgentMcpServerStore(
      options.db,
      options.secrets,
      join(options.dataDir, 'managed-mcp'),
      (value) => {
        if (!this.mintedSecrets.includes(value)) this.mintedSecrets.push(value)
      },
    )
    this.providerEvents = new DurableAgentEventBuffer((entry) => this.commitProviderEvent(entry))
    this.frames = new SessionFrames({
      publish,
      webhooks: this.webhooks,
      store: this.store,
      shutdown: this.shutdown.signal,
    })
    this.instructionAdmission = new LazyService(async () => {
      const [{ InstructionAdmission }, { InstructionReviewStore }] = await Promise.all([
        import('./instructionAdmission'),
        import('./instructionReviewStore'),
      ])
      return new InstructionAdmission(this.core, options.dataDir, new InstructionReviewStore(this.db, options.secrets))
    })
    this.mcpReviews = new LazyService(() =>
      import('../mcpReviewManager').then(
        ({ McpReviewManager }) => new McpReviewManager(this.mcpServers, () => this.mintedSecrets),
      ),
    )
    this.goals = new LazyService(() =>
      import('./sessionGoalGeneration').then(
        ({ SessionGoalGeneration }) =>
          new SessionGoalGeneration({
            db: this.db,
            store: this.store,
            models: this.core.models,
            currentUserId: this.currentUserId,
            publish: (session) => this.frames.emit({ channel: 'agent:session', session }),
            enqueue: async (sessionId, prompt, key, signal) => {
              await this.acceptTurn(
                sessionId,
                {
                  source: 'goal',
                  input: [{ type: 'text', text: prompt }],
                  effectivePolicy: {},
                  idempotencyKey: key,
                },
                {},
                signal,
              )
            },
          }),
      ),
    )
    this.upkeep = new ProcessUpkeep({
      processes: this.processes,
      store: this.store,
      folders: { attachments: this.attachments.root, artifacts: this.artifacts.root },
      core: this.core,
      currentUserId: this.currentUserId,
      telemetry: this.telemetry,
      idleSweepMs: options.idleSweepMs ?? IDLE_SWEEP_MS,
      shutdown: this.shutdown.signal,
      record: (sessionId, turnId, event) => this.record(sessionId, turnId, event),
      endTurnSpan: (turnId, outcome) => this.endTurnSpan(turnId, outcome),
      pauseGoal: (sessionId) => this.pauseGoal(sessionId),
      pump: () => {
        void this.pump()
      },
    })
    // Armed at construction when there is a host to report to, and cleared by stop().
    if (this.telemetry) this.processes.armFootprintSample(options.footprintSampleMs ?? FOOTPRINT_SAMPLE_MS)
  }

  private async pauseGoal(sessionId: string): Promise<void> {
    await (await this.goals.get()).pause(sessionId)
  }

  /**
   * Accepts a turn into the durable queue, for every source: a person, a workflow, a delegation, a
   * plugin, and a goal's own continuation. Every one passes the `before-send` hook and the checkout's
   * admission here.
   */
  async acceptTurn(
    sessionId: string,
    input: EnqueueAgentTurnInput,
    context: TurnAttendanceContext = {},
    signal?: AbortSignal,
  ): Promise<{ session: AgentSession; input: EnqueueAgentTurnInput['input']; outcome: EnqueueTurnOutcome }> {
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
    if (prompt && !prompt.ok) throw new TurnVetoedError(`${prompt.by}: ${prompt.reason}`)
    const enqueued =
      prompt && prompt.payload.text !== undefined
        ? { ...input, input: withPromptText(input.input, prompt.payload.text) }
        : input
    signal?.throwIfAborted()
    const outcome = await this.core.checkoutAdmission.admitWork(session.taskId, () =>
      this.store.enqueueTurn(sessionId, enqueued, context),
    )
    // An idle session behind the concurrency limit emits no provider event, so publish its queue count.
    this.frames.emit({ channel: 'agent:session', session: await this.store.requireSession(sessionId) })
    // The pump owns startup and admission after the durable acceptance boundary.
    void this.pump().catch(() => undefined)
    return { session, input: enqueued.input, outcome }
  }

  private turnFactsWriter(): Promise<TurnFactsWriter> {
    return (this.turnFacts ??= import('./turnFactsWriter').then(
      ({ TurnFactsWriter }) =>
        new TurnFactsWriter({
          db: this.db,
          projectOf: (taskId) => this.projectOf(taskId),
          written: (facts) =>
            this.publishLifecycle({
              channel: 'plugin:agents:turn-facts',
              taskId: facts.taskId,
              sessionId: facts.sessionId,
              turnId: facts.turnId,
            }),
        }),
    ))
  }

  private async projectOf(taskId: string): Promise<string | null> {
    return (await this.core.tasks.load(taskId))?.projectId ?? null
  }

  // Startup repair rather than a schedule: each pass converges, and does a session or a turn once
  // (docs/schedules.md § Limits). First the tool calls and file changes stored before the ledger fold,
  // put into the shape it writes, then the facts of finished turns that have none. Not awaited, because
  // a pass over a large database takes many seconds and boot waits on the runtime's reconcile().
  repairHistoryInBackground(): void {
    if (this.stopped || this.historyRepair) return
    const controller = new AbortController()
    const done = compactLedgers(this.db, {
      signal: controller.signal,
      onError: (sessionId, error) =>
        log.warn(`could not compact session ${sessionId}: ${describeError(error).message}`),
    })
      .then(
        (totals) => {
          if (totals.deleted || totals.rewritten) {
            log.info(
              `compacted ${totals.sessions} sessions: removed ${totals.deleted} superseded rows, rewrote ${totals.rewritten}`,
            )
          }
        },
        (error: unknown) => log.warn(`ledger compaction stopped: ${describeError(error).message}`),
      )
      .then(async () => {
        if (controller.signal.aborted) return
        const { backfillTurnFacts } = await import('./turnFactsBackfill')
        await backfillTurnFacts(this.db, { projectOf: (taskId) => this.projectOf(taskId), signal: controller.signal })
      })
      .catch((error: unknown) => log.warn(`turn facts backfill stopped: ${describeError(error).message}`))
    this.historyRepair = { controller, done }
  }

  // Releases what this engine holds, in the order docs/managed-agents/operations.md § Operations and failure
  // describes. Called from the plugin's dispose before the database closes.
  stop(): Promise<void> {
    return (this.stopPromise ??= this.stopEngine())
  }

  private async stopEngine(): Promise<void> {
    this.stopped = true
    this.shutdown.abort(new Error('The managed agent runtime is shutting down.'))
    await (await this.goals.built())?.stop()
    this.processes.abortAndClearTimers()
    const queueDrain = this.queue.stop()
    // Stops at its next step. Awaited, because the database closes once stop() returns.
    this.historyRepair?.controller.abort()
    await this.historyRepair?.done
    this.historyRepair = null
    let retirementFailure: unknown
    try {
      await this.processes.stopAll()
    } catch (error) {
      retirementFailure = error
    }
    await (await this.mcpReviews.built())?.close()
    // Each harness has stopped, so every steer has settled or is about to, and its row is written
    // before the database closes.
    await Promise.all(this.steers)
    await queueDrain
    await this.processes.joinCallbacks()
    await this.providerEvents.flushAll()
    await this.store.flushSearch()
    await (await this.turnFacts)?.idle()
    await this.frames.stop()
    await this.webhooks.stop()
    this.turnSpans.clear()
    this.eventMaterializer.clear()
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

  ensureSession(
    session: AgentSession,
    admission?: { turnId: string; workspaceId: string },
  ): Promise<ProviderGeneration> {
    return this.processes.ensure(session, admission)
  }

  get shutdownSignal(): AbortSignal {
    return this.shutdown.signal
  }
  get isStopped(): boolean {
    return this.stopped
  }
  currentSession(sessionId: string) {
    return this.processes.current(sessionId)
  }

  /** A provider event in the shape the ledger stores, for a caller outside the provider's own stream,
   *  such as the loop hook bridge. */
  materialize(sessionId: string, turnId: string | null, event: AgentDriverEvent): Promise<AgentNormalizedEvent[]> {
    return this.eventMaterializer.map(sessionId, turnId, event)
  }

  /** Queues an event behind the session's buffered provider events, so the ledger keeps their order. */
  acceptProviderEvent(pending: PendingAgentEvent): Promise<void> {
    return this.providerEvents.accept(pending)
  }

  sessionSignal(generation: ProviderGeneration): AbortSignal {
    return this.processes.signal(generation)
  }
  hasLiveSession(sessionId: string): boolean {
    return this.processes.has(sessionId)
  }
  liveSessionIds(): string[] {
    return this.processes.ids()
  }
  withSessionHandle<T>(
    generation: ProviderGeneration,
    operation: (handle: AgentDriverSession) => Promise<T>,
  ): Promise<T> {
    return this.processes.withHandle(generation, operation)
  }
  withCurrentSessionHandle<T>(
    generation: ProviderGeneration,
    operation: (handle: AgentDriverSession) => Promise<T>,
  ): Promise<T | null> {
    return this.processes.withCurrentHandle(generation, operation)
  }
  sessionHandleIfPresent<T>(
    sessionId: string,
    operation: (handle: AgentDriverSession) => Promise<T>,
  ): Promise<T | null> {
    return this.processes.handleIfPresent(sessionId, operation)
  }
  flushProviderEvents(sessionId: string): Promise<void> {
    return this.providerEvents.flush(sessionId)
  }

  /** Revokes a deleted session's task token, so a copy of it stops working at once
   *  (docs/security/credentials.md § Revoking a credential). */
  revokeSessionCredential(session: Pick<AgentSession, 'id' | 'taskId'>): void {
    this.internalEnv.revokeSession?.({ taskId: session.taskId, sessionId: session.id })
  }

  /** The config folder of the account the session is pinned to, or null for the harness's default
   *  login (docs/managed-agents/accounts.md). Every start and terminal handoff reads it, so this is
   *  also where the person's own skills and settings are linked in. */
  async accountHome(session: AgentSession): Promise<string | null> {
    const account = sessionAccount(session.config)
    if (!account) return null
    if (!(await this.accounts.has(session.providerId, account)))
      throw new Error(`This session runs on the '${account}' account, which was removed from this Node.`)
    return this.linkedAccountFolder(session.providerId, account)
  }

  /** An account's folder with the person's own skills and settings linked in, for any process that
   *  runs the harness's CLI on it. */
  async linkedAccountFolder(providerId: string, account: string): Promise<string> {
    const home = this.accounts.home(providerId, account)
    const { skills, settings } = this.registry.create(providerId)?.accounts ?? {}
    // A session that starts without the person's skills or settings still works, so a failure here
    // doesn't stop it.
    if (skills)
      await linkSharedSkills(home, skills).catch((error) =>
        log.warn(`could not link shared skills into account '${account}': ${describeError(error).message}`),
      )
    if (settings)
      await linkSharedSettings(home, settings).catch((error) =>
        log.warn(`could not link shared settings into account '${account}': ${describeError(error).message}`),
      )
    return home
  }

  private scopedProviderEnvironment(session: AgentSession, sandboxed: boolean): Record<string, string> {
    // The session row is the authority for the tool ceiling across restarts. A sandboxed start narrows
    // it to write tools, because every execute tool, such as a run target, a workflow, a delegated
    // agent, or the browser, runs outside the harness's sandbox (docs/managed-agents/read-block.md).
    const persisted = persistedToolCeiling(session.config)
    const env = {
      ...this.internalEnv({
        scope: 'task',
        taskId: session.taskId,
        sessionId: session.id,
        toolCeiling: sandboxed ? delegatedToolCeiling(persisted, { maxRisk: 'write' }) : persisted,
      }),
      ACORN_TASK_ID: session.taskId,
      ACORN_SESSION_ID: session.id,
    }
    for (const secret of secretEnvironmentValues(env))
      if (!this.mintedSecrets.includes(secret)) this.mintedSecrets.push(secret)
    return env
  }

  // The first turn after a start ran with its skills. The catalogue hears which
  // harness got which skills and how, the session row keeps the names the agent was told so a later
  // start knows which are gone, and the transcript gets one line a reader on either host can see.
  private async skillsDelivered(sessionId: string, report: SkillReport): Promise<void> {
    const session = await this.store.requireSession(sessionId)
    recordSkillDelivery(agentProfileRegistry.get(session.profileId)?.label ?? session.providerId, report)
    if (JSON.stringify(session.config.skillIndex ?? []) !== JSON.stringify(report.told)) {
      await this.store.patchSession(sessionId, { config: { ...session.config, skillIndex: report.told } })
    }
    await this.record(sessionId, null, {
      type: 'diagnostic',
      level: 'info',
      message: (await import('../drivers/skillIndex')).skillReportLine(report),
    })
  }

  private async providerMcpServers(
    session: AgentSession,
    env: Record<string, string>,
    signal: AbortSignal,
  ): Promise<{ servers: AgentDriverMcpServer[]; unavailable: string[]; retire?: () => Promise<void> }> {
    const userMcp = await this.mcpServers.resolve(
      sessionMcpSelection(session.config),
      'agent MCP server: start a session',
      signal,
    )
    signal.throwIfAborted()
    const releaseManagedRoots = this.mcpServers.holdManagedRoots(userMcp.managedRoots)
    for (const secret of userMcp.secrets) if (!this.mintedSecrets.includes(secret)) this.mintedSecrets.push(secret)
    const servers: AgentDriverMcpServer[] = []
    const unavailable = [...userMcp.unavailable]
    try {
      for (const server of userMcp.servers) {
        signal.throwIfAborted()
        const identity = userMcp.revisions[server.name]
        // A signed-in server always goes through the relay, because the relay is what holds its token.
        if (!identity?.reviewTools && !identity?.signIn) {
          servers.push(server)
          continue
        }
        try {
          const relayed = await (
            await this.mcpReviews.get()
          ).prepare(server, session.id, {
            revision: identity.revision,
            review: identity.reviewTools,
            ...(identity.signIn && server.transport === 'http'
              ? { signedFetch: await this.mcpServers.signedFetch(server.name, server.url) }
              : {}),
          })
          if (relayed.transport === 'http') {
            const bearer = relayed.headers.Authorization
            if (bearer && !this.mintedSecrets.includes(bearer)) this.mintedSecrets.push(bearer)
          }
          servers.push(relayed)
        } catch {
          unavailable.push(`${server.name} (relay unavailable)`)
        }
      }
      signal.throwIfAborted()
    } catch (error) {
      await (await this.mcpReviews.built())?.closeSession(session.id)
      releaseManagedRoots()
      throw error
    }
    return {
      servers: [...acornMcpServers(this.mcp(), session, env), ...servers],
      unavailable,
      retire: async () => {
        try {
          await (await this.mcpReviews.built())?.closeSession(session.id)
        } finally {
          releaseManagedRoots()
        }
      },
    }
  }

  private async onProviderStartFailed(sessionId: string, turnId: string | null, error: unknown): Promise<void> {
    await this.record(sessionId, turnId, {
      type: 'error',
      code: 'provider_start_failed',
      message: safeProviderMessage(error, 'Provider session failed to start.', this.mintedSecrets),
      retryable: false,
    })
  }

  private async onProviderEvent(
    sessionId: string,
    generation: ProviderGeneration,
    event: AgentDriverEvent,
  ): Promise<void> {
    if (event.type === 'session_state' && event.state === 'ready' && this.processes.isReadinessHeld(sessionId)) return
    const live = this.processes.current(sessionId)
    if (!live || live.closing || !this.processes.owns(generation)) return
    this.processes.heard(generation, !['session_state', 'session_metadata', 'diagnostic', 'error'].includes(event.type))
    const turnId = event.acornTurnId === undefined ? live.activeTurnId : event.acornTurnId
    // Rewritten before anything below awaits, so the message keeps its place among the events around it.
    if (event.type === 'steer_taken') {
      const text = this.steeredText.get(event.turnId)
      this.steeredText.delete(event.turnId)
      if (text === undefined || !turnId) return
      event = { type: 'user_message', text, steeredTurnId: event.turnId }
    }
    if (event.type === 'request' || event.type === 'permission_request' || event.type === 'input_request') {
      const session = await this.store.requireSession(sessionId)
      const turn = turnId ? await this.store.turn(turnId) : null
      const attendance = turn
        ? persistedAttendance(turn.effectivePolicy, { session, source: turn.source })
        : sessionAttendance(session)
      const { settleAutonomousRequest } = await import('./requestPolicy')
      if (
        await settleAutonomousRequest(
          {
            attendance,
            owned: () => this.processes.owns(generation),
            materialize: (request) => this.eventMaterializer.map(sessionId, turnId, request),
            accept: (recorded) => this.providerEvents.accept({ sessionId, turnId, event: recorded, generation }),
            respond: (requestId, resolution) =>
              this.withSessionHandle(generation, (handle) => handle.resolveRequest(requestId, resolution)),
          },
          event,
        )
      )
        return
      if (event.type === 'permission_request') {
        const { settlePermissionRequest } = await import('./permissionPolicy')
        return settlePermissionRequest(
          {
            attendance,
            hooks: this.hooks,
            session: () => this.store.requireSession(sessionId),
            taskRoot: (taskId) => this.core.tasks.requireRoot(taskId),
            materialize: (request) => this.eventMaterializer.map(sessionId, turnId, request),
            owned: () => this.processes.owns(generation),
            accept: (recorded) => this.providerEvents.accept({ sessionId, turnId, event: recorded, generation }),
          },
          event,
        )
      }
    }
    for (const normalized of await this.eventMaterializer.map(sessionId, turnId, event)) {
      if (!this.processes.owns(generation)) return
      if (turnId && (await this.deferForUsageLimit(sessionId, turnId, generation, normalized))) continue
      if (!this.processes.owns(generation)) return
      await this.providerEvents.accept({ sessionId, turnId, event: normalized, generation })
    }
  }

  private async deferForUsageLimit(
    sessionId: string,
    turnId: string,
    generation: ProviderGeneration,
    event: AgentNormalizedEvent,
  ): Promise<boolean> {
    if (!this.usageLimitResetAt || !mayBeUsageLimit(event)) return false
    const providerId = this.processes.current(sessionId)?.providerId
    if (!providerId) return false
    // The session's own account, whose quota ran out, not the harness's default login.
    const account = sessionAccount((await this.store.requireSession(sessionId)).config)
    const resetAt = await awaitWithSignal(
      this.usageLimitResetAt(providerId, account).catch(() => null),
      this.processes.signal(generation),
    )
    if (resetAt == null || !this.processes.owns(generation)) return false
    const resumeAt = Math.max(Date.now(), resetAt + this.usageContinuationGraceMs)
    // Any streamed answer fragments must precede the scheduler's diagnostic in the durable ledger.
    await this.providerEvents.flush(sessionId)
    if (!this.processes.owns(generation)) return false
    const turn = await this.store.deferTurnForUsageLimit(turnId, resumeAt, usageContinuationInput())
    if (!turn || !this.processes.owns(generation)) return false
    this.processes.clearActive(generation, turnId)
    this.endTurnSpan(turnId, 'requeued')
    this.frames.emit({ channel: 'agent:turn', turn })
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

  private async commitProviderEvent({ sessionId, event, turnId, generation }: PendingAgentEvent): Promise<void> {
    const live = this.processes.current(sessionId)
    const settlesTurn = event.type === 'turn_completed' || event.type === 'error'
    if (settlesTurn) {
      if (live && (!generation || live.generation === generation))
        this.processes.clearActive(live.generation, turnId ?? undefined)
      if (turnId && (!live || !generation || live.generation === generation)) {
        this.endTurnSpan(turnId, event.type === 'error' ? 'error' : 'completed')
      }
    }
    await this.record(sessionId, turnId, event)
    // Advisory, so a failure is logged and never holds up the event behind it.
    if (event.type === 'tool' && turnId && event.tool.input) {
      await this.repeatedToolCallWarnings()
        .then((warnings) => warnings.observe(sessionId, turnId, event.tool))
        .catch((error: unknown) => log.warn(`repeated tool call check failed: ${describeError(error).message}`))
    }
    // The two things that change what the roster knows: a roster update, which is also how a child
    // first appears, and a child's own traffic. Each pushes the quiet sweep back, so a child that
    // keeps streaming keeps its row and a child that stops loses it a window later. Turn boundaries
    // are deliberately not on this list, and a session with no children never holds a timer.
    if (event.type === 'subagent' || eventSubagentId(event)) this.processes.armQuiet(sessionId)
    if (settlesTurn) {
      if (this.repeatedToolCalls) (await this.repeatedToolCalls).forget(sessionId)
      if (turnId) void this.goals.get().then((goals) => goals.check(sessionId, turnId))
      void this.pump()
    }
  }

  private repeatedToolCallWarnings(): Promise<RepeatedToolCallWarnings> {
    return (this.repeatedToolCalls ??= import('./repeatedToolCalls').then(
      ({ RepeatedToolCallWarnings }) =>
        new RepeatedToolCallWarnings({
          limit: async () => {
            const userId = this.currentUserId()
            return (userId ? await readAgentSessionDefaults(this.core.prefs, userId) : defaultAgentSessionDefaults())
              .warnRepeatedToolCallsAfter
          },
          record: (sessionId, turnId, event) =>
            this.stopped ? Promise.resolve() : this.record(sessionId, turnId, event),
          session: (sessionId) => this.store.requireSession(sessionId),
          notice: (notice) => {
            if (!this.stopped) this.notice?.(notice)
          },
        }),
    ))
  }

  // A backgrounded child never reports that it finished. Its spawning `Agent` call returns a launch
  // receipt and then says nothing more about it, so the only way its row can ever end is if we infer
  // the end from silence (docs/managed-agents/subagents.md § Subagents). This is that inference, debounced:
  // every event the child produces pushes the sweep back, so it fires a full quiet window after the
  // last thing we heard. A real completion summary on a later turn still folds the row on to
  // `completed`, so nothing is lost by guessing `idle` first.
  private async quietSubagents(sessionId: string): Promise<void> {
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
    const waiting = session.subagents.some(
      (entry) => entry.background && isActiveSubagent(entry) && !quieted.includes(entry.id),
    )
    if (waiting) this.processes.armQuiet(sessionId)
  }

  private async onProviderClosed(
    sessionId: string,
    generation: ProviderGeneration,
    attempt: number,
    error?: Error,
  ): Promise<void> {
    if (!this.processes.owns(generation)) return
    const message = safeProviderMessage(error, 'Provider process closed.', this.mintedSecrets)
    const interruptedTurnId = this.processes.current(sessionId)?.activeTurnId
    await this.store.interruptActiveTurn(sessionId, message)
    if (!this.processes.owns(generation)) return
    if (interruptedTurnId) await this.pauseGoal(sessionId)
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

  cancelInstructionScan(turnId: string): void {
    this.instructionScans.get(turnId)?.abort(new Error('Turn cancelled.'))
  }

  private async dispatchQueuedTurn(
    session: AgentSession,
    turn: AgentTurn,
    generation: ProviderGeneration,
  ): Promise<boolean> {
    this.processes.beginDispatch(generation)
    await this.store.dispatchTurn(turn.id)
    try {
      turn = await this.store.restoreTurnAttendance(turn.id)
      const input = turn.continuationInput ?? turn.input
      const { attendanceInstructions } = await import('./attendanceInstructions')
      const instructions = attendanceInstructions(
        persistedAttendance(turn.effectivePolicy, { session, source: turn.source }),
      )
      const driverInput = instructions ? [{ type: 'text' as const, text: instructions }, ...input] : input
      await this.record(session.id, turn.id, {
        type: 'user_message',
        text: agentTurnInputText({ ...turn, input }),
        ...(turn.continuationInput || turn.source === 'goal' ? { automatic: true } : {}),
      })
      const sent = await this.prepareSend(session, turn.id, input, generation)
      if (!sent || !this.processes.owns(generation)) return false
      // What memory changed since the session was last told, as a part for this turn (./memoryChanges.ts).
      const { memoryNote } = await import('./memoryChanges')
      const memory = await memoryNote(session.id, this.store, this.currentStandingContext, (event) =>
        this.record(session.id, null, event),
      )
      await this.store.startTurn(turn.id)
      if (!this.processes.owns(generation)) return false
      this.beginTurnSpan(turn.id, session.id, session.providerId, turn.source)
      this.processes.sendTurn(
        generation,
        { turn, input: memory ? [memory.part, ...driverInput] : driverInput, attachments: sent },
        async (result) => {
          if (!this.processes.owns(generation)) return
          if (result.providerTurnRef) await this.store.setTurnProviderRef(turn.id, result.providerTurnRef)
          // Only once the turn has run, so a failed turn offers the same change again.
          await memory?.deliver()
        },
        async (error) => {
          if (!this.processes.owns(generation) || this.processes.current(session.id)?.activeTurnId !== turn.id) return
          this.processes.clearActive(generation, turn.id)
          const failure = this.processes.driverFailure(generation, error)
          if (failure === 'safe_transient' && !this.processes.accepted(generation) && turn.attempt < 3) {
            const message = safeProviderMessage(error, 'Safe transient provider failure.', this.mintedSecrets)
            // The same turn id starts again, so its first attempt's span has to close here or
            // the next attempt would replace an open handle in the map.
            this.endTurnSpan(turn.id, 'requeued')
            await this.store.requeueTransientTurn(turn.id, message)
            await this.record(session.id, turn.id, {
              type: 'diagnostic',
              level: 'warning',
              message: `Provider rejected the turn before accepting output; retrying (${turn.attempt + 1}/3).`,
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
              message: safeProviderMessage(error, 'Provider turn failed.', this.mintedSecrets),
              retryable: false,
            },
          })
          void this.pump()
        },
      )
    } catch (error) {
      this.processes.clearActive(generation, turn.id)
      await this.providerEvents.accept({
        sessionId: session.id,
        turnId: turn.id,
        generation,
        event: {
          type: 'error',
          code: error instanceof InstructionAdmissionError ? error.code : 'turn_dispatch_failed',
          message: safeProviderMessage(error, 'Agent turn preparation failed.', this.mintedSecrets),
          retryable: false,
        },
      })
    }
    return true
  }

  /**
   * What every send owes before its driver call, for a dispatch and a steer alike: the instruction
   * check, the secret check on attachment bytes, and the attachments copied where the session can
   * read them. Null when the provider generation was replaced partway, so the caller sends nothing.
   */
  private async prepareSend(
    session: AgentSession,
    turnId: string,
    input: AgentInputPart[],
    generation: ProviderGeneration,
  ): Promise<AgentDriverTurnOptions['attachments'] | null> {
    const attachments = Object.fromEntries(
      await Promise.all(
        [
          ...new Set(
            input.flatMap((part) => (part.type === 'attachment' || part.type === 'image' ? [part.attachmentId] : [])),
          ),
        ].map(async (attachmentId) => {
          const attachment = await this.attachments.resolve(attachmentId)
          if (!attachment) throw new Error(`Attachment is unavailable: ${attachmentId}`)
          return [
            attachmentId,
            {
              id: attachment.id,
              filename: attachment.filename,
              mediaType: attachment.mediaType,
              byteSize: attachment.byteSize,
              localPath: attachment.localPath,
            },
          ] as const
        }),
      ),
    )
    if (!this.processes.owns(generation)) return null
    // The queue is shared by interactive, resumed, workflow, operation and delegated turns.
    // Admission belongs immediately before the driver, including retries of a durable turn and a steer.
    const scan = new AbortController()
    this.instructionScans.set(turnId, scan)
    const stopScan = () => scan.abort(this.shutdown.signal.reason)
    if (this.shutdown.signal.aborted) stopScan()
    else this.shutdown.signal.addEventListener('abort', stopScan, { once: true })
    try {
      await (await this.instructionAdmission.get()).admit(session.taskId, scan.signal)
    } finally {
      this.instructionScans.delete(turnId)
      this.shutdown.signal.removeEventListener('abort', stopScan)
    }
    if (!this.processes.owns(generation)) return null
    // Attachments leave the machine with this send. With blocking on, their stored bytes pass the
    // secret gate here, on every turn source, including a retry.
    if (Object.keys(attachments).length && this.core.secretPublication) {
      const { admitAttachments } = await import('./secretPublication')
      await admitAttachments(this.core.secretPublication, {
        sessionId: session.id,
        providerId: session.providerId,
        attachments: Object.values(attachments),
      })
      if (!this.processes.owns(generation)) return null
    }
    // Copied only once admitted, because the session can read its folder: under the read block,
    // the store itself is out of its reach.
    return Object.fromEntries(
      await Promise.all(
        Object.entries(attachments).map(
          async ([id, attachment]) =>
            [id, { ...attachment, localPath: await this.attachments.copyToSession(session.id, attachment) }] as const,
        ),
      ),
    )
  }

  /**
   * Hands a queued turn to the session's running turn, for the agent to read at its next step
   * (docs/managed-agents/steering.md § What a steer does). Returns once the harness has the
   * message, with the row `steering`. The outcome follows as a turn frame: `steered` when the agent
   * took it, or `queued` again when the turn ended first. A row returns `queued` and unchanged when no
   * turn is running, because dispatch sends it next anyway.
   *
   * The checks a dispatch runs before its send run here too, and a failed one leaves the row queued.
   */
  async steerTurn(sessionId: string, turnId: string): Promise<AgentTurn> {
    const session = await this.store.requireSession(sessionId)
    if (session.controller !== 'acorn') throw new Error(`Session input is controlled by ${session.controller}.`)
    if (session.archivedAt) throw new Error('Archived sessions cannot accept turns.')
    if (session.kind !== 'interactive') throw new Error('Only an interactive session can be steered.')
    const queued = await this.store.turn(turnId)
    if (!queued || queued.sessionId !== sessionId) throw new Error('Agent turn not found.')
    // A repeated request answers what the first one started.
    if (queued.status === 'steering' || queued.status === 'steered') return queued
    if (queued.status !== 'queued') throw new Error('Only a queued turn can be steered.')
    // A workflow, delegation, or plugin waits on its own turn id to settle, and a steered turn never does.
    if (queued.source !== 'interactive') throw new Error('Only a message you sent can be steered.')
    const live = this.processes.current(sessionId)
    const activeTurnId = live?.activeTurnId
    if (!live || !activeTurnId || session.runtimeState === 'cancelling') return queued
    const generation = live.generation
    const steerable = await this.processes.withCurrentHandle(generation, async (handle) => !!handle.steer)
    if (steerable === null) return queued
    if (!steerable) throw new Error("This session's harness does not support steering a running turn.")

    const steering = await this.store.beginSteer(turnId)
    if (!steering) return (await this.store.turn(turnId)) ?? queued
    await this.emitTurnAndSession(steering)
    let attachments: AgentDriverTurnOptions['attachments'] | null
    try {
      attachments = await this.prepareSend(session, turnId, steering.input, generation)
    } catch (error) {
      await this.returnSteer(turnId)
      // The refusal a dispatch would record, unchanged, so the route answers it the way it answers any.
      throw error
    }
    if (!attachments) return this.returnSteer(turnId)
    this.steeredText.set(turnId, agentTurnInputText(steering))
    const options = { turn: steering, input: steering.input, attachments, activeTurnId }
    const outcome = this.processes
      .withCurrentHandle(generation, (handle) => handle.steer!(options))
      .catch((error: unknown) => {
        log.warn(`steering turn ${turnId} failed: ${describeError(error).message}`)
        return null
      })
    const settled = outcome
      .then((result) => this.settleSteer(sessionId, turnId, generation, result))
      .catch((error: unknown) => log.warn(`settling steered turn ${turnId} failed: ${describeError(error).message}`))
    this.steers.add(settled)
    void settled.finally(() => this.steers.delete(settled))
    return steering
  }

  private async settleSteer(
    sessionId: string,
    turnId: string,
    generation: ProviderGeneration,
    outcome: 'taken' | 'missed' | null,
  ): Promise<void> {
    this.steeredText.delete(turnId)
    if (outcome === 'taken') {
      // The `steered` row commits with the message. One still `steering` past this point lost its
      // message with the harness that held it, which only happens when that harness stopped.
      await this.providerEvents.flush(sessionId)
      if ((await this.store.turn(turnId))?.status !== 'steering' || this.processes.owns(generation)) return
    }
    await this.returnSteer(turnId)
  }

  /** Puts a turn the running turn didn't take back in the queue, which dispatch sends next. */
  private async returnSteer(turnId: string): Promise<AgentTurn> {
    const turn = await this.store.missSteer(turnId)
    if (!turn) throw new Error('Agent turn not found.')
    await this.emitTurnAndSession(turn)
    void this.pump()
    return turn
  }

  // A steer moves a row in or out of the queue without an event, so its turn and the session's queue
  // count go out here.
  private async emitTurnAndSession(turn: AgentTurn): Promise<void> {
    if (this.stopped) return
    this.frames.emit({ channel: 'agent:turn', turn })
    this.frames.emit({ channel: 'agent:session', session: await this.store.requireSession(turn.sessionId) })
  }

  /** `settle: false` skips the session's command settle, for a caller that settles every session itself. */
  async record(
    sessionId: string,
    turnId: string | null,
    event: AgentNormalizedEvent,
    { settle = true }: { settle?: boolean } = {},
  ): Promise<AgentEventRecord> {
    const record = await this.store.recordEvent(sessionId, turnId, event)
    if (record.turnId) this.timeTurnEvent(record.turnId, event)
    const session = await this.store.requireSession(sessionId)
    let clientRecord = record
    if (
      record.event.type === 'tool' &&
      record.event.tool.kind === 'execute' &&
      record.event.tool.status !== undefined
    ) {
      const { commandStatus } = await import('./commandLifecycle')
      const turn = record.turnId ? await this.store.turn(record.turnId) : null
      clientRecord = {
        ...record,
        event: {
          type: 'tool',
          tool: {
            ...record.event.tool,
            status: commandStatus(record.event.tool, turn ?? undefined, session),
          },
        },
      }
    }
    this.frames.emit({ channel: 'agent:event', event: clientRecord })
    await this.emitProjection(sessionId, record.turnId, event)
    // Only when the event changed what the row says. Most events in a streamed reply move nothing on
    // the row except its sequence and clock, and the row is large, mostly the harness's skills list, so
    // sending it after every event would fill the agent socket with rows. The comparison skips `config`
    // because of its size, so the one event that writes it, `session_metadata`, always sends.
    if (event.type === 'session_metadata' || this.frames.rowChanged(session)) {
      this.frames.emit({ channel: 'agent:session', session })
    }
    if (settle) {
      // A turn's end changes only that turn's commands. A session state or a child's end can change any.
      if (event.type === 'turn_completed' || event.type === 'error') {
        await this.settleCommands({ sessionId, turnId: turnId ?? undefined })
      } else if (
        (event.type === 'session_state' &&
          ['ready', 'stopped', 'failed', 'archived', 'reconnecting'].includes(event.state)) ||
        (event.type === 'subagent' && ['idle', 'completed', 'failed'].includes(event.subagent.status ?? ''))
      ) {
        await this.settleCommands({ sessionId })
      }
    }
    return record
  }

  /** Append lifecycle endings past client cursors. Read projection also covers untouched history.
   *  Answers the commands it left pending or running. */
  async settleCommands(scope: CommandScope): Promise<AgentEventRecord[]> {
    const { commandStatus } = await import('./commandLifecycle')
    const unfinished: AgentEventRecord[] = []
    for (const record of await this.store.unfinishedCommands(scope)) {
      if (record.event.type !== 'tool') continue
      const session = await this.store.requireSession(record.sessionId)
      const turn = record.turnId ? await this.store.turn(record.turnId) : null
      const status = commandStatus(record.event.tool, turn ?? undefined, session)
      if (status === 'pending' || status === 'running') unfinished.push(record)
      if (status === record.event.tool.status) continue
      await this.record(record.sessionId, record.turnId, {
        type: 'tool',
        tool: {
          id: record.event.tool.id,
          title: '',
          kind: 'execute',
          status,
          subagentId: record.event.tool.subagentId,
        },
      })
    }
    return unfinished
  }

  // The row a projected event changed, sent with the event, so a client updates that row rather than
  // refetching the whole snapshot. `recordEvent` writes the request row in the same transaction as the
  // event, and a turn's status is already committed by the time its `turn_completed` is recorded.
  //
  // `error` is deliberately not here: it also expires this session's pending requests, which is a set
  // this projection cannot name, so the client still refetches for that one (REFETCH_EVENT_TYPES).
  private async emitProjection(sessionId: string, turnId: string | null, event: AgentNormalizedEvent): Promise<void> {
    if (event.type === 'request' || event.type === 'request_resolved') {
      const request = await this.store.request(sessionId, event.requestId)
      if (request) this.frames.emit({ channel: 'agent:request', request })
      return
    }
    if (event.type === 'user_message' && event.steeredTurnId) {
      const steered = await this.store.turn(event.steeredTurnId)
      if (steered) this.frames.emit({ channel: 'agent:turn', turn: steered })
    }
    if (!turnId || (event.type !== 'user_message' && event.type !== 'turn_completed')) return
    const turn = await this.store.turn(turnId)
    if (turn) this.frames.emit({ channel: 'agent:turn', turn })
  }

  /** A turn's span, opened where the turn is dispatched to a provider. Not where it was enqueued:
   *  a turn can sit in the queue behind the concurrency limit for minutes, and "how long did the
   *  agent take" is not "how long was the node busy". */
  private beginTurnSpan(turnId: string, sessionId: string, providerId: string, source: string): void {
    if (!this.telemetry?.enabled()) return
    const span = this.telemetry.startSpan('agent.turn', {
      attrs: { seam: 'agent.turn', 'turn.id': turnId, 'session.id': sessionId, provider: providerId, source },
    })
    this.turnSpans.set(turnId, { span, startedAt: performance.now(), approvalWaitMs: 0, waiting: new Map() })
  }

  /** The two waits inside a turn, so a slow provider reads apart from a person who hadn't yet
   *  clicked Allow: the time to the provider's first output, and the time spent on permission asks. */
  private timeTurnEvent(turnId: string, event: AgentNormalizedEvent): void {
    const turn = this.turnSpans.get(turnId)
    if (!turn) return
    const now = performance.now()
    if (
      turn.firstOutputMs === undefined &&
      (event.type === 'assistant_message' || event.type === 'reasoning' || event.type === 'tool')
    )
      turn.firstOutputMs = now - turn.startedAt
    if (event.type === 'request' && event.kind === 'permission' && !event.blocked)
      turn.waiting.set(event.requestId, now)
    if (event.type === 'request_resolved') {
      const asked = turn.waiting.get(event.requestId)
      turn.waiting.delete(event.requestId)
      if (asked !== undefined) turn.approvalWaitMs += now - asked
    }
  }

  /** Close it, from whichever of the four ways a turn stops being active got there first. `end` is
   *  idempotent, so a race between a provider closing and its last event arriving costs nothing. */
  private endTurnSpan(turnId: string, outcome: 'completed' | 'error' | 'interrupted' | 'requeued'): void {
    const turn = this.turnSpans.get(turnId)
    this.turnSpans.delete(turnId)
    if (!turn) return
    const now = performance.now()
    // An ask still open when the turn ended was waited on until now.
    let approvalWaitMs = turn.approvalWaitMs
    for (const asked of turn.waiting.values()) approvalWaitMs += now - asked
    turn.span.end(outcome === 'completed' ? 'ok' : 'error', {
      outcome,
      'approval.wait.ms': approvalWaitMs,
      ...(turn.firstOutputMs === undefined ? {} : { 'first_output.ms': turn.firstOutputMs }),
    })
  }

  forkContext(source: AgentSession, instruction?: string): ReturnType<typeof buildForkContext> {
    return buildForkContext(this.store, source, instruction)
  }

  stopLive(sessionId: string): Promise<void> {
    return this.processes.stop(sessionId)
  }
}
