import { pluginChannel } from '@acorn/protocol/pluginState.ts'
import { agentProfileRegistry, AGENTS_HARNESS_REGISTRY, getProfile, type InternalEnvFactory, type NodePlugin, resolveCommand } from '@acorn/plugin-api/node'
import { TERMINAL_SESSIONS } from '@acorn/plugin-terminal/contract/sessions.ts'
import { join } from 'node:path'
import { AGENTS_SESSION_EXECUTE } from '../contract/sessionExecute'
import { claudeHarness } from '../main/drivers/claudeHarness'
import { CodexAgentDriver } from '../main/drivers/codexDriver'
import { agentDriverRegistry } from '../main/drivers/registry'
import { createHarnessRegistry } from '../main/harnessRegistry'
import { readAgentPricingPreferences, writeAgentPricingPreferences } from '../main/pricingStore'
import { ManagedAgentRuntime } from '../main/runtime'
import { AGENTS_RUNTIME } from '../contract/runtime'
import { createSessionExecute } from '../main/sessionExecute'
import { agentUsageCollectors } from '../main/usage/collectors'
import { readAgentConcurrency, writeAgentConcurrency } from '../main/concurrencyStore'
import { readAgentSessionDefaults, writeAgentSessionDefaults } from '../main/sessionDefaultsStore'
import { collectClaudeUsage } from '../main/usage/claudeUsage'
import { collectCodexUsage } from '../main/usage/codexUsage'
import { createAgentUsageService } from '../main/usage/service'
import { managedAgents, MANAGED_AGENTS } from '../server/routes/managed'
import { managedAgentsBridge } from '../server/routes/managedBridge'
import { agentUsage, AGENT_USAGE } from '../server/routes/usage'
import { aiderProfile, claudeCodeProfile, codexProfile } from '../main/index'

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
// (main/usage/collectors.ts). `probeDir` is only known at init, so it arrives as a parameter.
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
  memoryReviewTrigger?: (taskId: string, transcriptTail: string) => Promise<void>
}

// `dataDir` stays a parameter, unlike changes' and github's: the runtime writes attachments, artifacts
// and the usage probe under the data root, so this plugin needs the path for more than its database.
export const agentsPlugin = (dataDir: string, deps: AgentsPluginDeps): NodePlugin => {
  let runtime: ManagedAgentRuntime | null = null
  let managedRoute: { dispose(): void } | null = null
  let usageRoute: { dispose(): void } | null = null
  let harnessRoute: { dispose(): void } | null = null
  return {
    name: 'agents',
    required: true,
    // docs/data-layer.md § Migrations: this plugin's migration chain, opened and closed by the host.
    migrationsModule: import.meta.url,
    init: (ctx) => {
      registerBuiltInProfiles()
      registerBuiltInDrivers()
      // Migrated before init returns, so no request or provider spawn reaches an unmigrated database.
      // See docs/data-layer.md § Migrations.
      const store = ctx.storage.open()
      const core = ctx.core

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
        internalEnv: deps.internalEnv,
        secrets: core.secrets,
        // Read per call, never captured. Creating a task's worktree consults that owner's per-repo
        // `base_ref` preference, and an account switch must not be served from a cached value.
        currentUserId: () => core.identity.active(),
        publish: (frame) => ctx.events.send(frame),
        startTerminalHandoff: async (session) => {
          if (!session.providerSessionRef) throw new Error('The provider session cannot be resumed in a terminal.')
          const profile = getProfile(session.profileId)
          if (profile.id !== session.profileId || !profile.resumeArgv) {
            throw new Error(`Profile '${session.profileId}' does not support terminal resume.`)
          }
          const sessions = ctx.capabilities.get(TERMINAL_SESSIONS)
          if (!sessions) throw new Error('Terminal engine is unavailable.')
          const resume = profile.resumeArgv(resolveCommand(profile), session.providerSessionRef)
          const terminal = await sessions.create({
            taskId: session.taskId,
            profileId: session.profileId,
            title: `${session.title} · terminal`,
            command: [resume.file, ...resume.args].map(shellQuote).join(' '),
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
        onCompletedTurn: deps.memoryReviewTrigger,
      })

      managedRoute = ctx.capabilities.provide(MANAGED_AGENTS, managedAgentsBridge(runtime))
      // Local provider usage plus the pricing overrides it costs against. The probe directory sits
      // under the data root, and the pricing read goes through `CoreServices.prefs` because `prefs` is
      // core's table (main/pricingStore.ts).
      const probeDir = join(dataDir, 'agent-usage-probe')
      registerBuiltInUsageCollectors(probeDir)
      usageRoute = ctx.capabilities.provide(AGENT_USAGE, {
        ...createAgentUsageService({
          probeDir,
          pricingForUser: (userId) => readAgentPricingPreferences(core.prefs, userId),
          onRefreshed: () => ctx.events.send({ channel: pluginChannel('agents', 'usage-refreshed') }),
        }),
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
      })

      // agents.harnessRegistry (docs/managed-agents.md § Harnesses). The plugin host resolves this per
      // contributed harness, so a node with agents disabled drops them and re-enabling redelivers.
      harnessRoute = ctx.capabilities.provide(AGENTS_HARNESS_REGISTRY, createHarnessRegistry())

      ctx.routes.register(managedAgents, { prefix: '', note: 'managed agent sessions, turns, attachments, artifacts' })

      // This plugin's sessions, for the merged run list core assembles (@acorn/protocol/runs.ts). A
      // pointer at the route above; nothing here knows workflows is on the same list.
      ctx.runs.register({ runs: '/v2/p/agents/runs' })
      ctx.routes.register(agentUsage, { prefix: '', note: '/usage, /pricing, /concurrency, /session-defaults — account-scoped provider usage, dispatch limits, and new-session defaults' })

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

      // agents.sessionExecute (contract/sessionExecute.ts). The workflow runner resolves this at call
      // time and falls back to its own headless runner, so a node without this plugin still runs
      // non-managed workflow steps.
      ctx.capabilities.provide(AGENTS_SESSION_EXECUTE, createSessionExecute(runtime))
      // reconcile() runs from the composition root, not here: it has to run after the listener binds,
      // and it interrupts every unsettled session. Same reason as workflows (contract/runtime.ts).
      ctx.capabilities.provide(AGENTS_RUNTIME, { reconcile: () => runtime!.reconcile() })
    },
    // Releases what init acquired, in the order docs/managed-agents.md § Operations and failure
    // describes.
    dispose: async () => {
      await runtime?.stop()
      runtime = null
      managedRoute?.dispose()
      usageRoute?.dispose()
      harnessRoute?.dispose()
      for (const dispose of builtInProfileDisposables ?? []) dispose()
      builtInProfileDisposables = null
      for (const dispose of builtInDriverDisposables ?? []) dispose()
      builtInDriverDisposables = null
      for (const dispose of builtInCollectorDisposables ?? []) dispose()
      builtInCollectorDisposables = null
    },
  }
}
