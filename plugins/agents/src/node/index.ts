import { AGENT_STANDING_CONTEXT } from '../contract/standingContext'
import { readAgentCheckoutActivity } from '../server/sessions/checkoutActivity'
import { holdAwakeWhileBusy } from '../server/sessions/keepAwake'
import { NODE_KEEP_AWAKE } from '@acorn/protocol/api.ts'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import {
  acornMcp,
  agentProfileRegistry,
  AGENTS_CUSTOM_AGENT_REGISTRY,
  AGENTS_HARNESS_REGISTRY,
  getProfile,
  lazyRouter,
  registerDeletedTaskPurge,
  type InternalEnvFactory,
  type NodePlugin,
  resolveCommand,
} from '@acorn/plugin-api/node'
import { TERMINAL_SESSIONS } from '@acorn/plugin-terminal/contract/sessions.ts'
import { NOTES_SPAWN_SNAPSHOT } from '@acorn/plugin-notes/contract/spawnSnapshot.ts'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { McpPackageManager } from '../server/mcpPackageManager'
import { AGENTS_SESSION_CONTROL, AGENTS_SESSION_EXECUTE } from '../contract/sessionExecute'
import { claudeHarness } from '../server/drivers/claudeHarness'
import { CodexAgentDriver } from '../server/drivers/codexDriver'
import { agentDriverRegistry } from '../server/drivers/registry'
import { createHarnessRegistry } from '../server/harnessRegistry'
import { readAgentPricingPreferences, writeAgentPricingPreferences } from '../server/pricingStore'
import { ManagedAgentRuntime } from '../server/sessions/runtime'
import { acornMcpServers } from '../server/sessions/runtimeEngine'
import { BEFORE_PERMISSION_HOOK } from '../contract/permissionHook.ts'
import { AFTER_TOOL_HOOK, BEFORE_TOOL_HOOK } from '../contract/loopHook.ts'
import { AGENTS_SESSION_MESSENGER } from '../contract/sessionMessages.ts'
import type { SessionMessages } from '../server/sessions/sessionMessages'
import { AGENTS_TURN_FOLLOW_UP } from '../contract/turnFollowUp.ts'
import type { TurnFollowUps } from '../server/sessions/turnFollowUps'
import { AGENTS_RUNTIME } from '../contract/runtime'
import { AGENTS_DEFAULT_PROFILE } from '../contract/defaultProfile'
import { AGENTS_DRAFT_ATTACHMENTS } from '../contract/draftAttachments'
import {
  AGENTS_ACTIVITY,
  AGENTS_REQUESTS,
  AGENTS_REVIEW_INPUT,
  AGENTS_SESSIONS,
  AGENTS_TURNS,
} from '../contract/lifecycle'
import { createDraftAttachments } from '../server/sessions/draftAttachments'
import { AGENTS_TRANSCRIPT_MEDIA } from '../contract/transcriptMedia'
import { createTranscriptMedia } from '../server/sessions/transcriptMedia'
import { createSessionControl } from '../server/sessions/sessionControl'
import { AGENTS_TOOL_CALLER } from '../contract/toolCaller'
import { createToolCallers } from '../server/sessions/toolCaller'
import { agentUsageCollectors } from '../server/usage/collectors'
import { readAgentConcurrency, writeAgentConcurrency } from '../server/concurrencyStore'
import { readAgentSessionDefaults, writeAgentSessionDefaults } from '../server/sessionDefaultsStore'
import {
  contributedCustomAgent,
  customAgentRegistry,
  deleteCustomAgent,
  readCustomAgents,
  saveCustomAgent,
} from '../server/customAgents'
import { createAgentUsageService } from '../server/usage/service'
import { AgentAccounts, agentAccountsRoot } from '../server/accounts'
import { managedAgents, MANAGED_AGENTS } from '../server/routes/managed'
import { managedAgentsBridge } from '../server/routes/managedBridge'
import { agentUsage, AGENT_USAGE } from '../server/routes/usage'
import { AGENT_MCP_SERVERS } from '../server/routes/mcpServersBridge'
import { agentLoopHooks, AGENT_LOOP_HOOKS } from '../server/routes/loopHook'
import { agentInstructionReview, AGENT_INSTRUCTION_REVIEW } from '../server/routes/instructionReview'
import { agentSecurityDiagnostics, AGENT_SECURITY_DIAGNOSTICS } from '../server/routes/securityDiagnostics'
import { STATIC_DEPENDENCY_POLICY } from '@acorn/protocol/dependencyPolicy.ts'
import { claudeHandoffMcp, codexHandoffMcp } from '../server/profiles/mcpCommands'
import { sessionMcpSelection } from '../shared/mcpServers'
import { aiderProfile, claudeCodeProfile, codexProfile } from '../server/profiles/index'
import { AgentDelegationStore } from '../server/delegation/store'
import { AgentDelegationService } from '../server/delegation/service'
import { delegationTools } from '../server/delegation/tools'
import { sessionHistoryTools } from '../server/sessions/sessionHistoryTools'
import { crossSessionTools } from '../server/sessions/crossSessionTools'
import { createSessionSourceHandler } from '../server/data/sessionSourceHandler'
import { sessionSource } from '../shared/sessionSource'
import { usageSource } from '../shared/usageRegistration'
import { removeExpiredHistory } from '../server/sessions/historyRetention'

let builtInProfileDisposables: (() => void)[] | null = null
export function registerBuiltInProfiles(): void {
  if (builtInProfileDisposables) return
  builtInProfileDisposables = [claudeCodeProfile, codexProfile, aiderProfile].map((profile) =>
    agentProfileRegistry.register(profile),
  )
}

// The two built-in harnesses, one per tier. See docs/managed-agents/harnesses.md § Harnesses. Claude is a launch
// spec run by the shared generic driver. Codex keeps a native driver, because its app-server carries
// fork, compaction, archive, and delete, and ACP expresses none of them.
//
// Released in `dispose` like the profiles beside them, because one process can boot the runtime several
// times. `apps/node/src/composition/runtime.test.ts` does.
let builtInDriverDisposables: (() => void)[] | null = null
function registerBuiltInDrivers(): void {
  if (builtInDriverDisposables) return
  builtInDriverDisposables = [
    agentDriverRegistry.register(claudeHarness),
    agentDriverRegistry.registerNative('codex', () => new CodexAgentDriver()),
  ]
}

// The two built-in plan-usage probes, one per built-in harness. They register beside the drivers rather
// than inside the usage service, because a plugin-contributed harness feeds the same registry
// (`agentUsageCollectors`). `probeDir` is only known at init, so it arrives as a parameter.
// Each probe's module loads on its first collection, which keeps it out of the node's boot graph for a
// read that spawns the provider's CLI and takes seconds anyway.
let builtInCollectorDisposables: (() => void)[] | null = null
function registerBuiltInUsageCollectors(probeDir: string): void {
  if (builtInCollectorDisposables) return
  builtInCollectorDisposables = [
    agentUsageCollectors.register({
      provider: claudeHarness.id,
      label: claudeHarness.label,
      ...(claudeHarness.glyph ? { glyph: claudeHarness.glyph } : {}),
      collect: async (pricing, home) =>
        (await import('../server/usage/claudeUsage')).collectClaudeUsage({ probeDir, pricing, home }),
      accounts: true,
    }),
    agentUsageCollectors.register({
      provider: 'codex',
      label: 'Codex',
      glyph: 'brand:agents/codex',
      collect: async (_pricing, home) =>
        (await import('../server/usage/codexUsage')).collectCodexUsage({ cwd: probeDir, home }),
      accounts: true,
    }),
  ]
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

// What this plugin cannot resolve for itself.
export type AgentsPluginDeps = {
  // Mints the per-session loopback credential, from the composition root rather than CoreServices.
  // See docs/security/credentials.md § Credential handling.
  internalEnv: InternalEnvFactory
  // Resolves after runtime and delegation recovery. Orchestration calls wait for it so a retried
  // spawn cannot race the repair of the same creating ledger row.
  reconciled: Promise<void>
}

// `dataDir` stays a parameter, unlike changes' and github's: the runtime writes attachments, artifacts
// and the usage probe under the data root, so this plugin needs the path for more than its database.
export const agentsPlugin = (dataDir: string, deps: AgentsPluginDeps): NodePlugin => {
  let runtime: ManagedAgentRuntime | null = null
  let packageManager: Promise<McpPackageManager> | null = null
  const managedPackages = (): Promise<McpPackageManager> =>
    (packageManager ??= Promise.all([
      import('../server/mcpPackageManager'),
      import('../server/mcpPackageInstall'),
    ]).then(
      async ([{ McpPackageManager }, { trustedNpmCli }]) =>
        new McpPackageManager(join(dataDir, 'managed-mcp'), await trustedNpmCli(), runtime!.mcpServers),
    ))
  let delegation: AgentDelegationService | null = null
  let toolCallers: ReturnType<typeof createToolCallers> | null = null
  let messages: Promise<SessionMessages> | null = null
  let followUps: Promise<TurnFollowUps> | null = null
  let reconcileMessages: (() => Promise<void>) | null = null
  let pluginsChanged: { dispose(): void } | null = null
  let projectChanged: { dispose(): void } | null = null
  let managedRoute: { dispose(): void } | null = null
  let usageRoute: { dispose(): void } | null = null
  let mcpServersRoute: { dispose(): void } | null = null
  let loopHooksRoute: { dispose(): void } | null = null
  let instructionReviewRoute: { dispose(): void } | null = null
  let securityDiagnosticsRoute: { dispose(): void } | null = null
  let harnessRoute: { dispose(): void } | null = null
  let customAgentRoute: { dispose(): void } | null = null
  let draftAttachmentsRoute: { dispose(): void } | null = null
  let transcriptMediaRoute: { dispose(): void } | null = null
  let lifecycleCapabilities: Array<{ dispose(): void }> = []
  let stopCheckoutActivity: (() => void) | null = null
  let stopKeepAwake: (() => void) | null = null
  return {
    name: 'agents',
    label: 'Agents',
    required: true,
    emits: [
      { verb: 'turn-changed', description: 'An agent turn changed queue or execution state' },
      { verb: 'request-changed', description: 'An agent input request was created or changed state' },
      {
        verb: 'sessions-changed',
        description: 'A managed agent session was created, renamed, archived, restored, or deleted',
      },
      { verb: 'activity', description: 'A tool call or subagent started or finished, or the context fill changed' },
      { verb: 'usage-refreshed', description: 'The cached agent plan usage snapshot was refreshed' },
    ],
    // docs/data-layer/migrations.md § Migrations: this plugin's migration chain, opened and closed by the host.
    migrationsModule: import.meta.url,
    init: (ctx) => {
      ctx.audit.declare({ id: 'mcp-publication-exception', label: 'Reviewed MCP package publication exception' })
      ctx.audit.declare({ id: 'mcp-package-activation', label: 'Activated managed MCP package' })
      ctx.audit.declare({ id: 'mcp-catalogue-approval', label: 'Approved MCP tool catalogue' })
      ctx.audit.declare({ id: 'mcp-sign-in', label: 'Signed in to an MCP server' })
      ctx.audit.declare({ id: 'mcp-sign-out', label: 'Signed out of an MCP server' })
      registerBuiltInProfiles()
      registerBuiltInDrivers()
      // Migrated before init returns, so no request or provider spawn reaches an unmigrated database.
      // See docs/data-layer/migrations.md § Migrations.
      const store = ctx.storage.open()
      const core = ctx.core
      stopCheckoutActivity = core.checkoutAdmission.registerOwner('turns', (taskIds) =>
        readAgentCheckoutActivity(store, taskIds),
      )
      // The runtime and the Usage page share one service. A suspected limit failure asks only its own
      // harness collector for a fresh reset time; ordinary page reads keep using the cached snapshot.
      const probeDir = join(dataDir, 'agent-usage-probe')
      registerBuiltInUsageCollectors(probeDir)
      // One folder record for the runtime and the usage service, so both see the same accounts.
      const accounts = new AgentAccounts(agentAccountsRoot(dataDir))
      const usageService = createAgentUsageService({
        probeDir,
        accounts: async (providerId) => {
          const details = await accounts.details(providerId)
          return (await accounts.list(providerId)).map((name) => ({
            name,
            home: accounts.home(providerId, name),
            ...(details[name]?.label ? { label: details[name].label } : {}),
          }))
        },
        pricingForUser: (userId) => readAgentPricingPreferences(core.prefs, userId),
        onRefreshed: () => ctx.events.send({ channel: pluginChannel('agents', 'usage-refreshed') }),
        telemetry: ctx.telemetry,
      })

      // The first decision this plugin opens to other plugins (docs/plugins/hooks.md § Hooks). A prompt policy,
      // a redactor or a context injector registers a handler here; the point exists whether or not
      // anybody does, because declaring it is the consent. Required instruction checks don't run here:
      // the queue dispatcher runs them immediately before the driver sends, and this point keeps its
      // optional plugin-hook failure semantics.
      ctx.hooks.declare({
        id: 'before-send',
        label: 'send a prompt',
        payload: { sessionId: 'string', taskId: 'string', text: 'string' },
        allows: ['observe', 'transform', 'veto'],
      })
      // The second: a harness permission request, before anyone sees it. Observe and veto only
      // (`settlePermissionRequest`).
      ctx.hooks.declare(BEFORE_PERMISSION_HOOK)
      // The third and fourth: every tool call a bridged harness makes, before it runs and after
      // (docs/managed-agents/loop-hooks.md). Only `before-tool` allows `ask`.
      ctx.hooks.declare(BEFORE_TOOL_HOOK)
      ctx.hooks.declare(AFTER_TOOL_HOOK)

      runtime = new ManagedAgentRuntime({
        db: store,
        dataDir,
        accounts,
        core,
        hooks: ctx.hooks,
        telemetry: ctx.telemetry,
        internalEnv: deps.internalEnv,
        // Whatever the root configured, read here rather than captured: a harness session started
        // before the root set it would otherwise keep offering no tools for the life of the process.
        mcp: acornMcp,
        standingContext: (taskId) =>
          ctx.capabilities.get(AGENT_STANDING_CONTEXT)?.build(taskId) ?? Promise.resolve(null),
        secrets: core.secrets,
        // Read per call, never captured. Agent records and credentials remain scoped to the active
        // account, and an account switch must not be served from a cached value.
        currentUserId: () => core.identity.active(),
        notice: (notice) => ctx.events.notice(notice),
        usageLimitResetAt: async (providerId, account) => {
          const userId = core.identity.active()
          if (!userId) return null
          const defaults = await readAgentSessionDefaults(core.prefs, userId)
          if (!defaults.continueAfterUsageLimit) return null
          return usageService.depletedUntil({ userId, providerId, account })
        },
        publish: (frame) => {
          ctx.events.send(frame)
          // Every path that settles a turn announces it here, after its write commits, so this is the
          // one place a child's result can start its report home. The broadcast is not durable; the
          // delegation reconcile pass queues any report a crash cut off.
          if (frame.channel === 'plugin:agents:turn-changed' && frame.source === 'delegation') {
            delegation?.reports.deliverSafely(frame.turnId)
          }
          if (frame.channel === 'plugin:agents:turn-changed') toolCallers?.turnChanged(frame)
          if (frame.channel === 'plugin:agents:request-changed' && frame.status === 'pending') {
            delegation?.reports.deliverRequestSafely(frame.sessionId, frame.requestId)
          }
        },
        startTerminalHandoff: async (session) => {
          if (!session.providerSessionRef) throw new Error('The provider session cannot be resumed in a terminal.')
          const profile = getProfile(session.profileId)
          if (profile.id !== session.profileId || !profile.resumeArgv) {
            throw new Error(`Profile '${session.profileId}' does not support terminal resume.`)
          }
          const sessions = ctx.capabilities.get(TERMINAL_SESSIONS)
          if (!sessions) throw new Error('Terminal engine is unavailable.')
          const resume = profile.resumeArgv(resolveCommand(profile), session.providerSessionRef)
          // The session's MCP servers go with it, because `--resume` alone starts without them
          // (docs/mcp.md § Your own servers). A contributed harness has no terminal spelling for them yet.
          const mcp = await runtime!.mcpServers.resolve(
            sessionMcpSelection(session.config),
            'agent MCP server: continue in a terminal',
          )
          // Signed-in servers reach the terminal through relays of its own (relayHandoffServers).
          const { closeWhenStopped, relayHandoffServers } = await import('../server/terminalHandoffRelays')
          const relayOwner = `terminal-handoff-${randomUUID()}`
          const closeRelays = async () => (await runtime!.mcpReviews.built())?.closeSession(relayOwner)
          try {
            const servers = await relayHandoffServers(
              mcp,
              relayOwner,
              () => runtime!.mcpReviews.get(),
              (name, url) => runtime!.mcpServers.signedFetch(name, url),
            )
            // A Claude session on an account also needs acorn's own server, which its folder doesn't have. It
            // carries no login of its own: Claude passes the terminal's environment to every server it
            // starts, and the terminal holds its own task login.
            const handoff =
              profile.id === claudeCodeProfile.id
                ? claudeHandoffMcp([...acornMcpServers(acornMcp(), session, {}), ...servers])
                : profile.id === codexProfile.id
                  ? codexHandoffMcp(servers, mcp.secrets)
                  : { args: [], env: {} }
            const terminal = await sessions.create({
              taskId: session.taskId,
              profileId: session.profileId,
              title: `${session.title} · terminal`,
              command: [resume.file, ...resume.args, ...handoff.args].map(shellQuote).join(' '),
              // The CLI finds the session only in the folder of the account it started under.
              env: { ...handoff.env, ...(await runtime!.accountEnv(session)) },
              agentSessionId: session.id,
            })
            await closeWhenStopped(sessions, terminal.id, closeRelays)
            return terminal.id
          } catch (error) {
            await closeRelays()
            throw error
          }
        },
        // The return path of the same handoff. `false` with no terminal plugin is correct, not a
        // degradation: with no PTY engine, no shell holds the session, so control can return to acorn.
        terminalHandoffRunning: async (sessionId) => {
          const sessions = ctx.capabilities.get(TERMINAL_SESSIONS)
          if (!sessions) return false
          return (await sessions.list()).some(
            (terminal) => terminal.agentSessionId === sessionId && terminal.status === 'running',
          )
        },
      })
      stopKeepAwake = holdAwakeWhileBusy(
        (listener) => runtime!.frames.subscribe(listener),
        () => ctx.capabilities.get(NODE_KEEP_AWAKE)?.hold(),
      )
      // Archiving a task stops its provider processes, because otherwise they live until the node exits
      // (docs/managed-agents/operations.md § Operations and failure). A handler on core's hook rather than a task
      // check, because a check's cleanup runs only if the client asks for it. `transform` so core
      // waits for the stop before it removes the worktree. The payload comes back untouched.
      ctx.hooks.handle('core:task-archiving', {
        id: 'stop-sessions',
        mode: 'transform',
        run: async (payload) => {
          await runtime?.upkeep.stopTaskSessions(payload.taskId as string)
          return { payload }
        },
      })
      ctx.routes.fetch(createSessionSourceHandler(runtime), { prefix: '/data/sessions' })
      ctx.dataSources.register(sessionSource)
      ctx.routes.fetch(
        async (request, context) =>
          (await import('../server/data/usageSourceHandler')).createUsageSourceHandler(store, core)(request, context),
        { prefix: '/data/usage' },
      )
      ctx.dataSources.register(usageSource)

      // A plugin's notes to a session (`SessionMessages`). Entries are read live, and
      // `ready` and every roster change connect the ones a late or reloaded plugin filed.
      // Loaded on the first contribution, to stay inside the service boot budget
      // (apps/node/scripts/check-service-budget.mjs).
      ctx.extensionPoints.declare(AGENTS_SESSION_MESSENGER, 'Session messengers')
      // The reviewers a workflow step or a delegated turn offers its finished turn to, and the
      // operations their notes join (`TurnFollowUps`). Loaded on first use.
      ctx.extensionPoints.declare(AGENTS_TURN_FOLLOW_UP, 'Turn reviewers')
      const entries = () => ctx.extensionPoints.handlers(AGENTS_SESSION_MESSENGER)
      const messagesRuntime = runtime
      const followUpRegistry = () =>
        (followUps ??= import('../server/sessions/turnFollowUps').then(
          ({ TurnFollowUps }) =>
            new TurnFollowUps({
              runtime: messagesRuntime,
              entries: () => ctx.extensionPoints.handlers(AGENTS_TURN_FOLLOW_UP),
              delegationLive: async (turn) => (await delegation?.reports.operationLive(turn)) ?? false,
            }),
        ))
      reconcileMessages = async () => {
        if (!messages && !entries().length) return
        messages ??= import('../server/sessions/sessionMessages').then(
          ({ SessionMessages }) =>
            new SessionMessages({
              runtime: messagesRuntime,
              entries,
              notice: (notice) => ctx.events.notice(notice),
              followUps: followUpRegistry,
            }),
        )
        await (await messages).reconcile()
      }
      pluginsChanged = ctx.events.on('plugins:changed', () => void reconcileMessages?.().catch(() => undefined))

      delegation = new AgentDelegationService(
        runtime,
        new AgentDelegationStore(store),
        async () => (await ctx.capabilities.get(TERMINAL_SESSIONS)?.list()) ?? [],
        core.tasks,
        deps.reconciled,
        followUpRegistry,
        core,
        () => ctx.capabilities.get(NOTES_SPAWN_SNAPSHOT),
      )
      for (const tool of delegationTools(delegation)) ctx.tools.register(tool)
      for (const tool of sessionHistoryTools(runtime.store)) ctx.tools.register(tool)
      for (const tool of crossSessionTools(runtime.store, core)) ctx.tools.register(tool)

      managedRoute = ctx.capabilities.provide(MANAGED_AGENTS, managedAgentsBridge(runtime, delegation))
      lifecycleCapabilities = [
        ctx.capabilities.provide(AGENTS_DEFAULT_PROFILE, { id: claudeCodeProfile.id }),
        ctx.capabilities.provide(AGENTS_TURNS, {
          list: (filter) => runtime!.store.lifecycleTurns(filter),
        }),
        ctx.capabilities.provide(AGENTS_REQUESTS, {
          list: (filter) => runtime!.store.lifecycleRequests(filter),
        }),
        ctx.capabilities.provide(AGENTS_SESSIONS, {
          list: (taskId) => runtime!.store.lifecycleSessions(taskId),
        }),
        ctx.capabilities.provide(AGENTS_REVIEW_INPUT, {
          read: (ref) => runtime!.store.lifecycleReviewInput(ref),
        }),
        ctx.capabilities.provide(AGENTS_ACTIVITY, {
          read: (ref) => runtime!.store.lifecycleActivity(ref),
        }),
      ]
      // Local provider usage plus the pricing overrides it costs against. The probe directory sits
      // under the data root, and the pricing read goes through `CoreServices.prefs` because `prefs` is
      // core's table (`readAgentPricingPreferences`).
      usageRoute = ctx.capabilities.provide(AGENT_USAGE, {
        ...usageService,
        pricing: (userId) => readAgentPricingPreferences(core.prefs, userId),
        setPricing: (userId, preferences) => writeAgentPricingPreferences(core.prefs, userId, preferences),
        concurrency: (userId) => readAgentConcurrency(core.prefs, userId),
        // Drained straight after the write: raising a ceiling has to start the turns it just admitted,
        // and the dispatcher runs on events, not on a timer (docs/managed-agents/operations.md § Operations).
        setConcurrency: async (userId, limits) => {
          await writeAgentConcurrency(core.prefs, userId, limits)
          runtime?.drainQueue()
        },
        sessionDefaults: (userId) => readAgentSessionDefaults(core.prefs, userId),
        // Read, merge, write. Settings sends the checkbox and the pinned values; the runtime writes
        // `last` as sessions change, and neither should flatten the other.
        setSessionDefaults: async (userId, patch) => {
          const merged = { ...(await readAgentSessionDefaults(core.prefs, userId)), ...patch }
          await writeAgentSessionDefaults(core.prefs, userId, merged)
          return merged
        },
        customAgents: (userId) => readCustomAgents(core.prefs, userId),
        saveCustomAgent: (userId, id, input) => saveCustomAgent(core.prefs, userId, id, input),
        deleteCustomAgent: (userId, id) => deleteCustomAgent(core.prefs, userId, id),
      })
      instructionReviewRoute = ctx.capabilities.provide(AGENT_INSTRUCTION_REVIEW, {
        projects: async () => {
          const checkouts = await core.projects.checkouts()
          const projects = await Promise.all(checkouts.map(({ id }) => core.projects.byId(id)))
          return projects.flatMap((project) => (project?.path ? [{ id: project.id, name: project.name }] : []))
        },
        admission: () => runtime!.instructionAdmission.get(),
      })
      securityDiagnosticsRoute = ctx.capabilities.provide(AGENT_SECURITY_DIAGNOSTICS, {
        check: async (nodeId, userId, scope, signal) => {
          const { collectSecurityDiagnostics } = await import('../server/securityDiagnostics')
          return collectSecurityDiagnostics(
            {
              core,
              defaults: (owner) => readAgentSessionDefaults(core.prefs, owner),
              managedMcp: () => runtime!.mcpServers.list(),
              instructionObservation: async (projectId) =>
                (await runtime!.instructionAdmission.built())?.latest(projectId) ?? null,
              readBlockProviders: () => runtime!.providers.readBlockProviders(),
              staticDependencyPolicy: async (root, signal) => {
                const policy = ctx.capabilities.get(STATIC_DEPENDENCY_POLICY)
                return policy?.read(root, signal)
              },
            },
            nodeId,
            userId,
            scope,
            signal,
          )
        },
        scopes: async () => {
          const { securityScopeChoices } = await import('../server/securityDiagnostics')
          return securityScopeChoices(core)
        },
      })
      projectChanged = ctx.events.on('project:changed', (event) => {
        if (typeof event.projectId !== 'string') return
        const projectId = event.projectId
        void core.projects
          .byId(projectId)
          .then(async (project) => {
            if (!project) await (await runtime!.instructionAdmission.get()).store.deleteProject(projectId)
          })
          .catch(() => undefined)
      })

      // agents.harnessRegistry (docs/managed-agents/harnesses.md § Harnesses). The plugin host resolves this per
      // contributed harness, so a node with agents disabled drops them and re-enabling redelivers.
      harnessRoute = ctx.capabilities.provide(AGENTS_HARNESS_REGISTRY, createHarnessRegistry())
      // agents.customAgentRegistry (docs/managed-agents/custom-agents.md § Custom agents), delivered the same way, and
      // held in memory only, so a disabled plugin's agents leave New with it.
      customAgentRoute = ctx.capabilities.provide(AGENTS_CUSTOM_AGENT_REGISTRY, {
        register: (agent) => ({ dispose: customAgentRegistry.register(contributedCustomAgent(agent)) }),
      })

      ctx.routes.register(managedAgents, { prefix: '', note: 'managed agent sessions, turns, attachments, artifacts' })

      // This plugin's sessions, for the merged run list core assembles (`packages/protocol/src/runtime/runs.ts`). A
      // pointer at the route above; nothing here knows workflows is on the same list.
      ctx.runs.register({ runs: '/v1/p/agents/runs' })
      // Transcripts for the archive page's search (docs/plugins/search-providers.md § Search providers).
      ctx.search.register({
        id: 'sessions',
        label: 'Agent sessions',
        search: (query) => runtime!.store.searchTaskSessions(query.text, query.taskIds, query.limit),
      })
      ctx.routes.register(agentUsage, {
        prefix: '',
        note: '/usage, /pricing, /concurrency, /session-defaults, /custom-agents — account-scoped provider usage, dispatch limits, new-session defaults, and saved agents',
      })
      ctx.routes.register(agentInstructionReview, { prefix: '', note: 'device-only instruction review and approval' })
      ctx.routes.register(agentSecurityDiagnostics, { prefix: '', note: 'device-only passive security diagnostics' })

      // Settings → MCP servers (docs/mcp.md § Your own servers). The test reveals the server's secrets
      // the way a session start does, and redacts them out of whatever the server printed.
      mcpServersRoute = ctx.capabilities.provide(AGENT_MCP_SERVERS, {
        list: () => runtime!.mcpServers.list(),
        save: (name, input) => runtime!.mcpServers.save(name, input),
        remove: (name) => runtime!.mcpServers.remove(name),
        consent: (name, revision) => runtime!.mcpServers.consent(name, revision),
        test: async (name) => {
          const configured = await runtime!.mcpServers.get(name)
          if (configured && !configured.consented)
            return { ok: false, error: 'Review and consent to this exact server configuration before testing it.' }
          if (configured?.signIn && configured.signIn.status !== 'signed_in')
            return { ok: false, error: 'Sign in first.' }
          const resolved = await runtime!.mcpServers.resolve([name], 'agent MCP server: test the connection')
          if (resolved.unavailable.length)
            return { ok: false, error: 'A stored secret could not be opened. Enter it again and save.' }
          const [server] = resolved.servers
          if (!server) return null
          const signedFetch =
            resolved.revisions[name]?.signIn && server.transport === 'http'
              ? await runtime!.mcpServers.signedFetch(name, server.url)
              : undefined
          // Loaded on first use: the MCP client and its transports are a large part of a boot graph that
          // only this button needs (apps/node/scripts/check-service-budget.mjs).
          const { probeMcpServer } = await import('../server/mcpProbe')
          return probeMcpServer(server, resolved.secrets, signedFetch)
        },
        planPackage: async (coordinate, targetName, expectedRevision, exceptions, signal) => {
          const plan = await (
            await managedPackages()
          ).plan(coordinate, targetName, expectedRevision, exceptions, signal)
          for (const exception of plan.exceptions)
            ctx.audit.record('mcp-publication-exception', {
              subject: exception.coordinate,
              details: { reason: exception.reason, reviewedAt: exception.reviewedAt },
            })
          return plan
        },
        testPackagePlan: (name, planId, bin, signal) =>
          managedPackages().then((manager) => manager.testPlan(name, planId, bin, signal)),
        activatePackage: async (name, planId, bin, enabled, signal) => {
          const server = await (await managedPackages()).activate(name, planId, bin, enabled, signal)
          ctx.audit.record('mcp-package-activation', {
            subject: name,
            details: { package: server.managed?.package ?? '', version: server.managed?.version ?? '', bin },
          })
          return server
        },
        pendingReviews: async () => (await runtime!.mcpReviews.get()).pending(),
        approveReview: async (name, sessionId, revision, digest) => {
          const server = await (await runtime!.mcpReviews.get()).approve(name, sessionId, revision, digest)
          ctx.audit.record('mcp-catalogue-approval', { subject: name, details: { sessionId, digest } })
          return server
        },
        startSignIn: (name, redirectUri, deviceId) => runtime!.mcpServers.startSignIn(name, redirectUri, deviceId),
        finishSignIn: async (name, attemptId, deviceId, input) => {
          const server = await runtime!.mcpServers.finishSignIn(name, attemptId, deviceId, input)
          ctx.audit.record('mcp-sign-in', { subject: name, details: {} })
          return server
        },
        cancelSignIn: (name, attemptId, deviceId) => runtime!.mcpServers.cancelSignIn(name, attemptId, deviceId),
        signOut: async (name) => {
          const server = await runtime!.mcpServers.signOut(name)
          ctx.audit.record('mcp-sign-out', { subject: name, details: {} })
          return server
        },
      })
      // Loaded on its first request: Settings is the only caller, and nothing at boot needs it.
      ctx.routes.register(
        lazyRouter(async () => (await import('../server/routes/mcpServers')).agentMcpServers),
        {
          prefix: '',
          note: '/mcp-servers — the MCP servers acorn declares to agent sessions',
        },
      )

      // Harness bridges (docs/managed-agents/loop-hooks.md): a bridged harness's tool calls, and which
      // harnesses a plugin's tool hooks reach. Coverage is loaded on first use, like each bridge call.
      loopHooksRoute = ctx.capabilities.provide(AGENT_LOOP_HOOKS, {
        answer: (caller, request) => runtime!.loopHook(caller, request),
        coverage: async (pluginId) =>
          (await import('../server/sessions/loopHooks')).loopCoverage(
            ctx.hooks,
            await runtime!.providers.list(),
            pluginId,
          ),
      })
      ctx.routes.register(agentLoopHooks, {
        prefix: '',
        note: '/loop-hook, /loop-coverage — harness bridge calls and what they reach',
      })

      // Unattended usage collection, off by default (docs/schedules.md § What is registered today).
      ctx.schedules.register({
        scheduleId: 'usage-refresh',
        name: 'Refresh agent plan usage',
        cadence: { every: 30 * 60 },
        enabled: false,
        // The probes shell out to two CLIs; the engine's 60s default would time out a cold `claude`.
        timeout: 120,
        run: async () => {
          const userId = ctx.core.identity.active()
          // A node with no bound owner has no pricing preferences to cost the usage with, and
          // inventing an empty owner would cache the snapshot under the wrong key.
          if (!userId) return 'no owner is bound to this node yet'
          const snapshot = await ctx.capabilities.require(AGENT_USAGE).read({ userId, force: true })
          return `${snapshot.providers.filter((provider) => !provider.error).length} of ${snapshot.providers.length} providers answered`
        },
      })

      // The owner's "Keep agent history for archived tasks"
      // (docs/data-layer/backup-and-retention.md § Retention). Daily, and a no-op until the owner picks a
      // limit, so the setting is the one switch that matters.
      ctx.schedules.register({
        scheduleId: 'archived-history-prune',
        name: 'Remove agent history of long-archived tasks',
        cadence: { daily: '03:50' },
        timeout: 300,
        run: (signal) =>
          removeExpiredHistory({
            runtime: runtime!,
            prefs: core.prefs,
            userId: ctx.core.identity.active(),
            archivedBefore: (before) => ctx.core.tasks.archivedBefore(before),
            signal,
          }),
      })

      // Deleted tasks' sessions, transcripts and the rest (docs/workspaces-and-tasks/archive.md § Deleting
      // a task). The longest timeout the engine allows, because a task with a long history takes a while;
      // the next run carries on from where one stops.
      registerDeletedTaskPurge(ctx, (taskIds, signal) => runtime!.purgeDeletedTasks(taskIds, signal), { timeout: 300 })

      // agents.sessionExecute. The workflow runner resolves this at call
      // time and falls back to its own headless runner, so a node without this plugin still runs
      // non-managed workflow steps.
      // Loaded on the first step, to stay inside the service boot budget (apps/node/scripts/check-service-budget.mjs).
      const executeRuntime = runtime
      // The judge is the same one interactive goals use, so a step's completion check runs through its own harness.
      const goalJudge = { models: ctx.core.models, currentUserId: () => ctx.core.identity.active() }
      ctx.capabilities.provide(AGENTS_SESSION_EXECUTE, async (request) =>
        (await import('../server/sessions/sessionExecute')).createSessionExecute(
          executeRuntime,
          followUpRegistry,
          goalJudge,
        )(request),
      )
      ctx.capabilities.provide(AGENTS_SESSION_CONTROL, createSessionControl(runtime))
      // Who a signed tool call came from, for another plugin's tools (`AgentToolCallerLookup`).
      toolCallers = createToolCallers(runtime.store)
      ctx.capabilities.provide(AGENTS_TOOL_CALLER, toolCallers.lookup)
      // reconcile() runs from the composition root, not here: it has to run after the listener binds,
      // and it interrupts every unsettled session. Same reason as workflows (`AGENTS_RUNTIME`).
      ctx.capabilities.provide(AGENTS_RUNTIME, {
        reconcile: async () => {
          await runtime!.reconcile()
          await delegation!.reconcile()
        },
      })
      // agents.draftAttachments. What a plugin that edits an unsent image
      // attachment reaches this plugin through, since a sandbox cannot call another plugin's routes.
      // Read and write only, and only for a draft: the composer still owns which attachment is in the
      // turn, because the node cannot transact with an array in the client.
      draftAttachmentsRoute = ctx.capabilities.provide(
        AGENTS_DRAFT_ATTACHMENTS,
        createDraftAttachments(runtime.attachments),
      )
      // agents.transcriptMedia. What a plugin drawing a sent attachment or
      // an artifact reads the bytes through. Read-only, and only after checking the media belongs to
      // the session and the session to the task.
      const sessions = runtime.store
      transcriptMediaRoute = ctx.capabilities.provide(
        AGENTS_TRANSCRIPT_MEDIA,
        createTranscriptMedia({
          taskIdForSession: async (sessionId) => (await sessions.getSession(sessionId))?.taskId ?? null,
          attachments: runtime.attachments,
          artifacts: runtime.artifacts,
        }),
      )
    },
    ready: async () => {
      await reconcileMessages?.()
    },
    // Releases what init acquired, in the order docs/managed-agents/operations.md § Operations and failure
    // describes.
    dispose: async () => {
      stopCheckoutActivity?.()
      stopCheckoutActivity = null
      stopKeepAwake?.()
      stopKeepAwake = null
      // First, so no sender queues a turn on a runtime that is stopping.
      reconcileMessages = null
      void messages?.then((loaded) => loaded.dispose())
      messages = null
      followUps = null
      pluginsChanged?.dispose()
      pluginsChanged = null
      await runtime?.stop()
      if (packageManager) await packageManager.then((manager) => manager.close()).catch(() => undefined)
      packageManager = null
      runtime = null
      delegation = null
      managedRoute?.dispose()
      draftAttachmentsRoute?.dispose()
      transcriptMediaRoute?.dispose()
      usageRoute?.dispose()
      instructionReviewRoute?.dispose()
      securityDiagnosticsRoute?.dispose()
      projectChanged?.dispose()
      mcpServersRoute?.dispose()
      loopHooksRoute?.dispose()
      harnessRoute?.dispose()
      customAgentRoute?.dispose()
      for (const capability of lifecycleCapabilities) capability.dispose()
      lifecycleCapabilities = []
      for (const dispose of builtInProfileDisposables ?? []) dispose()
      builtInProfileDisposables = null
      for (const dispose of builtInDriverDisposables ?? []) dispose()
      builtInDriverDisposables = null
      for (const dispose of builtInCollectorDisposables ?? []) dispose()
      builtInCollectorDisposables = null
    },
  }
}
