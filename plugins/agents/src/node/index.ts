import { AGENT_STANDING_CONTEXT } from '../contract/standingContext'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import { acornMcp, agentProfileRegistry, AGENTS_CUSTOM_AGENT_REGISTRY, AGENTS_HARNESS_REGISTRY, getProfile, type InternalEnvFactory, type NodePlugin, resolveCommand } from '@acorn/plugin-api/node'
import { TERMINAL_SESSIONS } from '@acorn/plugin-terminal/contract/sessions.ts'
import { join } from 'node:path'
import { AGENTS_SESSION_CONTROL, AGENTS_SESSION_EXECUTE } from '../contract/sessionExecute'
import { claudeHarness } from '../server/drivers/claudeHarness'
import { CodexAgentDriver } from '../server/drivers/codexDriver'
import { agentDriverRegistry } from '../server/drivers/registry'
import { createHarnessRegistry } from '../server/harnessRegistry'
import { readAgentPricingPreferences, writeAgentPricingPreferences } from '../server/pricingStore'
import { ManagedAgentRuntime } from '../server/sessions/runtime'
import { AGENTS_RUNTIME } from '../contract/runtime'
import { AGENTS_DRAFT_ATTACHMENTS } from '../contract/draftAttachments'
import { AGENTS_REQUESTS, AGENTS_SESSIONS, AGENTS_TURNS } from '../contract/lifecycle'
import { createDraftAttachments } from '../server/sessions/draftAttachments'
import { createSessionExecute } from '../server/sessions/sessionExecute'
import { createSessionControl } from '../server/sessions/sessionControl'
import { agentUsageCollectors } from '../server/usage/collectors'
import { readAgentConcurrency, writeAgentConcurrency } from '../server/concurrencyStore'
import { readAgentSessionDefaults, writeAgentSessionDefaults } from '../server/sessionDefaultsStore'
import { contributedCustomAgent, customAgentRegistry, deleteCustomAgent, readCustomAgents, saveCustomAgent } from '../server/customAgents'
import { collectClaudeUsage } from '../server/usage/claudeUsage'
import { collectCodexUsage } from '../server/usage/codexUsage'
import { createAgentUsageService } from '../server/usage/service'
import { managedAgents, MANAGED_AGENTS } from '../server/routes/managed'
import { managedAgentsBridge } from '../server/routes/managedBridge'
import { agentUsage, AGENT_USAGE } from '../server/routes/usage'
import { agentMcpServers, AGENT_MCP_SERVERS } from '../server/routes/mcpServers'
import { claudeHandoffMcp, codexHandoffMcp } from '../server/profiles/mcpCommands'
import { sessionMcpSelection } from '../shared/mcpServers'
import { aiderProfile, claudeCodeProfile, codexProfile } from '../server/profiles/index'
import { AgentDelegationStore } from '../server/delegation/store'
import { AgentDelegationService } from '../server/delegation/service'
import { delegationTools } from '../server/delegation/tools'
import { createSessionSourceHandler } from '../server/data/sessionSourceHandler'
import { sessionSource } from '../shared/sessionSource'
import { removeExpiredHistory } from '../server/sessions/historyRetention'

let builtInProfileDisposables: (() => void)[] | null = null
export function registerBuiltInProfiles(): void {
  if (builtInProfileDisposables) return
  builtInProfileDisposables = [claudeCodeProfile, codexProfile, aiderProfile].map((profile) => agentProfileRegistry.register(profile))
}

// The two built-in harnesses, one per tier. See docs/managed-agents.md § Harnesses. Claude is a launch
// spec run by the shared generic driver. Codex keeps a native driver, because its app-server carries
// fork, compaction, archive, and delete, and ACP expresses none of them.
//
// Released in `dispose` like the profiles beside them, because one process can boot the runtime several
// times. `apps/node/src/service/runtime.test.ts` does.
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
// (../server/usage/collectors.ts). `probeDir` is only known at init, so it arrives as a parameter.
let builtInCollectorDisposables: (() => void)[] | null = null
function registerBuiltInUsageCollectors(probeDir: string): void {
  if (builtInCollectorDisposables) return
  builtInCollectorDisposables = [
    agentUsageCollectors.register({
      provider: claudeHarness.id,
      label: claudeHarness.label,
      ...(claudeHarness.glyph ? { glyph: claudeHarness.glyph } : {}),
      collect: (pricing) => collectClaudeUsage({ probeDir, pricing }),
    }),
    agentUsageCollectors.register({
      provider: 'codex',
      label: 'Codex',
      glyph: 'brand:agents/codex',
      collect: () => collectCodexUsage({ cwd: probeDir }),
    }),
  ]
}

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

// The one thing this plugin still cannot resolve for itself.
export type AgentsPluginDeps = {
  // Mints the per-session loopback credential, from the composition root rather than CoreServices.
  // See docs/security.md § Credential handling.
  internalEnv: InternalEnvFactory
  // Resolves after runtime and delegation recovery. Orchestration calls wait for it so a retried
  // spawn cannot race the repair of the same creating ledger row.
  reconciled: Promise<void>
}

// `dataDir` stays a parameter, unlike changes' and github's: the runtime writes attachments, artifacts
// and the usage probe under the data root, so this plugin needs the path for more than its database.
export const agentsPlugin = (dataDir: string, deps: AgentsPluginDeps): NodePlugin => {
  let runtime: ManagedAgentRuntime | null = null
  let delegation: AgentDelegationService | null = null
  let managedRoute: { dispose(): void } | null = null
  let usageRoute: { dispose(): void } | null = null
  let mcpServersRoute: { dispose(): void } | null = null
  let harnessRoute: { dispose(): void } | null = null
  let customAgentRoute: { dispose(): void } | null = null
  let draftAttachmentsRoute: { dispose(): void } | null = null
  let lifecycleCapabilities: Array<{ dispose(): void }> = []
  return {
    name: 'agents',
    label: 'Agents',
    required: true,
    emits: [
      { verb: 'turn-changed', description: 'An agent turn changed queue or execution state' },
      { verb: 'request-changed', description: 'An agent input request was created or changed state' },
      { verb: 'sessions-changed', description: 'A managed agent session was created, renamed, archived, restored, or deleted' },
      { verb: 'usage-refreshed', description: 'The cached agent plan usage snapshot was refreshed' },
    ],
    // docs/data-layer.md § Migrations: this plugin's migration chain, opened and closed by the host.
    migrationsModule: import.meta.url,
    init: (ctx) => {
      registerBuiltInProfiles()
      registerBuiltInDrivers()
      // Migrated before init returns, so no request or provider spawn reaches an unmigrated database.
      // See docs/data-layer.md § Migrations.
      const store = ctx.storage.open()
      const core = ctx.core
      // The runtime and the Usage page share one service. A suspected limit failure asks only its own
      // harness collector for a fresh reset time; ordinary page reads keep using the cached snapshot.
      const probeDir = join(dataDir, 'agent-usage-probe')
      registerBuiltInUsageCollectors(probeDir)
      const usageService = createAgentUsageService({
        probeDir,
        pricingForUser: (userId) => readAgentPricingPreferences(core.prefs, userId),
        onRefreshed: () => ctx.events.send({ channel: pluginChannel('agents', 'usage-refreshed') }),
      })

      // The one decision this plugin opens to other plugins (docs/plugins.md § Hooks). A prompt policy,
      // a redactor or a context injector registers a handler here; the point exists whether or not
      // anybody does, because declaring it is the consent.
      ctx.hooks.declare({
        id: 'before-send',
        label: 'send a prompt',
        payload: { sessionId: 'string', taskId: 'string', text: 'string' },
        allows: ['observe', 'transform', 'veto'],
      })

      runtime = new ManagedAgentRuntime({
        db: store,
        dataDir,
        core,
        hooks: ctx.hooks,
        telemetry: ctx.telemetry,
        internalEnv: deps.internalEnv,
        // Whatever the root configured, read here rather than captured: a harness session started
        // before the root set it would otherwise keep offering no tools for the life of the process.
        mcp: acornMcp,
        standingContext: (taskId) => ctx.capabilities.get(AGENT_STANDING_CONTEXT)?.build(taskId) ?? Promise.resolve(null),
        secrets: core.secrets,
        // Read per call, never captured. Agent records and credentials remain scoped to the active
        // account, and an account switch must not be served from a cached value.
        currentUserId: () => core.identity.active(),
        usageLimitResetAt: async (providerId) => {
          const userId = core.identity.active()
          if (!userId) return null
          const defaults = await readAgentSessionDefaults(core.prefs, userId)
          if (!defaults.continueAfterUsageLimit) return null
          return usageService.depletedUntil({ userId, providerId })
        },
        publish: (frame) => {
          ctx.events.send(frame)
          // Every path that settles a turn announces it here, after its write commits, so this is the
          // one place a child's result can start its report home. The broadcast is not durable; the
          // delegation reconcile pass queues any report a crash cut off.
          if (frame.channel === 'plugin:agents:turn-changed' && frame.source === 'delegation') {
            delegation?.reports.deliverSafely(frame.turnId)
          }
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
          const mcp = await runtime!.mcpServers.resolve(sessionMcpSelection(session.config), 'agent MCP server: continue in a terminal')
          const handoff = profile.id === claudeCodeProfile.id
            ? claudeHandoffMcp(mcp.servers)
            : profile.id === codexProfile.id ? codexHandoffMcp(mcp.servers, mcp.secrets) : { args: [], env: {} }
          const terminal = await sessions.create({
            taskId: session.taskId,
            profileId: session.profileId,
            title: `${session.title} · terminal`,
            command: [resume.file, ...resume.args, ...handoff.args].map(shellQuote).join(' '),
            env: handoff.env,
            agentSessionId: session.id,
          })
          return terminal.id
        },
        // The return path of the same handoff. `false` with no terminal plugin is correct, not a
        // degradation: with no PTY engine, no shell holds the session, so control can return to acorn.
        terminalHandoffRunning: async (sessionId) => {
          const sessions = ctx.capabilities.get(TERMINAL_SESSIONS)
          if (!sessions) return false
          return (await sessions.list()).some((terminal) =>
            terminal.agentSessionId === sessionId && terminal.status === 'running')
        },
      })
      // Archiving a task stops its provider processes, because otherwise they live until the node exits
      // (docs/managed-agents.md § Operations and failure). A handler on core's hook rather than a task
      // check, because a check's cleanup runs only if the client asks for it. `transform` so core
      // waits for the stop before it removes the worktree. The payload comes back untouched.
      ctx.hooks.handle('core:task-archiving', {
        id: 'stop-sessions',
        mode: 'transform',
        run: async (payload) => {
          await runtime?.stopTaskSessions(payload.taskId as string)
          return { payload }
        },
      })
      ctx.routes.fetch(createSessionSourceHandler(runtime), { prefix: '/data/sessions' })
      ctx.dataSources.register(sessionSource)

      delegation = new AgentDelegationService(
        runtime,
        new AgentDelegationStore(store),
        async () => await ctx.capabilities.get(TERMINAL_SESSIONS)?.list() ?? [],
        core.tasks,
        deps.reconciled,
      )
      for (const tool of delegationTools(delegation)) ctx.tools.register(tool)

      managedRoute = ctx.capabilities.provide(MANAGED_AGENTS, managedAgentsBridge(runtime, delegation))
      lifecycleCapabilities = [
        ctx.capabilities.provide(AGENTS_TURNS, {
          list: (filter) => runtime!.store.lifecycleTurns(filter),
        }),
        ctx.capabilities.provide(AGENTS_REQUESTS, {
          list: (filter) => runtime!.store.lifecycleRequests(filter),
        }),
        ctx.capabilities.provide(AGENTS_SESSIONS, {
          list: (taskId) => runtime!.store.lifecycleSessions(taskId),
        }),
      ]
      // Local provider usage plus the pricing overrides it costs against. The probe directory sits
      // under the data root, and the pricing read goes through `CoreServices.prefs` because `prefs` is
      // core's table (../server/pricingStore.ts).
      usageRoute = ctx.capabilities.provide(AGENT_USAGE, {
        ...usageService,
        pricing: (userId) => readAgentPricingPreferences(core.prefs, userId),
        setPricing: (userId, preferences) => writeAgentPricingPreferences(core.prefs, userId, preferences),
        concurrency: (userId) => readAgentConcurrency(core.prefs, userId),
        // Drained straight after the write: raising a ceiling has to start the turns it just admitted,
        // and the dispatcher runs on events, not on a timer (docs/managed-agents.md § Operations).
        setConcurrency: async (userId, limits) => {
          await writeAgentConcurrency(core.prefs, userId, limits)
          runtime?.drainQueue()
        },
        sessionDefaults: (userId) => readAgentSessionDefaults(core.prefs, userId),
        // Read, merge, write. Settings sends the checkbox and the pinned values; the runtime writes
        // `last` as sessions change, and neither should flatten the other.
        setSessionDefaults: async (userId, patch) => {
          const merged = { ...await readAgentSessionDefaults(core.prefs, userId), ...patch }
          await writeAgentSessionDefaults(core.prefs, userId, merged)
          return merged
        },
        customAgents: (userId) => readCustomAgents(core.prefs, userId),
        saveCustomAgent: (userId, id, input) => saveCustomAgent(core.prefs, userId, id, input),
        deleteCustomAgent: (userId, id) => deleteCustomAgent(core.prefs, userId, id),
      })

      // agents.harnessRegistry (docs/managed-agents.md § Harnesses). The plugin host resolves this per
      // contributed harness, so a node with agents disabled drops them and re-enabling redelivers.
      harnessRoute = ctx.capabilities.provide(AGENTS_HARNESS_REGISTRY, createHarnessRegistry())
      // agents.customAgentRegistry (docs/managed-agents.md § Custom agents), delivered the same way, and
      // held in memory only, so a disabled plugin's agents leave New with it.
      customAgentRoute = ctx.capabilities.provide(AGENTS_CUSTOM_AGENT_REGISTRY, {
        register: (agent) => ({ dispose: customAgentRegistry.register(contributedCustomAgent(agent)) }),
      })

      ctx.routes.register(managedAgents, { prefix: '', note: 'managed agent sessions, turns, attachments, artifacts' })

      // This plugin's sessions, for the merged run list core assembles (@acorn/protocol/runs.ts). A
      // pointer at the route above; nothing here knows workflows is on the same list.
      ctx.runs.register({ runs: '/v1/p/agents/runs' })
      // Transcripts for the archive page's search (docs/plugins.md § Search providers).
      ctx.search.register({
        id: 'sessions',
        label: 'Agent sessions',
        search: (query) => runtime!.store.searchTaskSessions(query.text, query.taskIds, query.limit),
      })
      ctx.routes.register(agentUsage, { prefix: '', note: '/usage, /pricing, /concurrency, /session-defaults, /custom-agents — account-scoped provider usage, dispatch limits, new-session defaults, and saved agents' })

      // Settings → MCP servers (docs/mcp.md § Your own servers). The test reveals the server's secrets
      // the way a session start does, and redacts them out of whatever the server printed.
      mcpServersRoute = ctx.capabilities.provide(AGENT_MCP_SERVERS, {
        list: () => runtime!.mcpServers.list(),
        save: (name, input) => runtime!.mcpServers.save(name, input),
        remove: (name) => runtime!.mcpServers.remove(name),
        test: async (name) => {
          const resolved = await runtime!.mcpServers.resolve([name], 'agent MCP server: test the connection')
          if (resolved.unavailable.length) return { ok: false, error: 'A stored secret could not be opened. Enter it again and save.' }
          const [server] = resolved.servers
          if (!server) return null
          // Loaded on first use: the MCP client and its transports are a large part of a boot graph that
          // only this button needs (apps/node/scripts/check-service-budget.mjs).
          const { probeMcpServer } = await import('../server/mcpProbe')
          return probeMcpServer(server, resolved.secrets)
        },
      })
      ctx.routes.register(agentMcpServers, { prefix: '', note: '/mcp-servers — the MCP servers acorn declares to agent sessions' })

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

      // The owner's "Keep agent history for archived tasks" (docs/data-layer.md § Retention). Daily,
      // and a no-op until the owner picks a limit, so the setting is the one switch that matters.
      ctx.schedules.register({
        scheduleId: 'archived-history-prune',
        name: 'Remove agent history of long-archived tasks',
        cadence: { daily: '03:50' },
        timeout: 300,
        run: (signal) => removeExpiredHistory({
          runtime: runtime!,
          prefs: core.prefs,
          userId: ctx.core.identity.active(),
          archivedBefore: (before) => ctx.core.tasks.archivedBefore(before),
          signal,
        }),
      })

      // agents.sessionExecute (contract/sessionExecute.ts). The workflow runner resolves this at call
      // time and falls back to its own headless runner, so a node without this plugin still runs
      // non-managed workflow steps.
      ctx.capabilities.provide(AGENTS_SESSION_EXECUTE, createSessionExecute(runtime))
      ctx.capabilities.provide(AGENTS_SESSION_CONTROL, createSessionControl(runtime))
      // reconcile() runs from the composition root, not here: it has to run after the listener binds,
      // and it interrupts every unsettled session. Same reason as workflows (contract/runtime.ts).
      ctx.capabilities.provide(AGENTS_RUNTIME, {
        reconcile: async () => {
          await runtime!.reconcile()
          await delegation!.reconcile()
        },
      })
      // agents.draftAttachments (contract/draftAttachments.ts). What a plugin that edits an unsent image
      // attachment reaches this plugin through, since a sandbox cannot call another plugin's routes.
      // Read and write only, and only for a draft: the composer still owns which attachment is in the
      // turn, because the node cannot transact with an array in the client.
      draftAttachmentsRoute = ctx.capabilities.provide(AGENTS_DRAFT_ATTACHMENTS, createDraftAttachments(runtime.attachments))
    },
    // Releases what init acquired, in the order docs/managed-agents.md § Operations and failure
    // describes.
    dispose: async () => {
      await runtime?.stop()
      runtime = null
      delegation = null
      managedRoute?.dispose()
      draftAttachmentsRoute?.dispose()
      usageRoute?.dispose()
      mcpServersRoute?.dispose()
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
