import { agentProfileRegistry, getProfile, type InternalEnvFactory, type NodePlugin, resolveCommand } from '@acorn/plugin-api/node'
import { TERMINAL_SESSIONS } from '@acorn/plugin-terminal/contract/sessions.ts'
import { join } from 'node:path'
import { AGENTS_SESSION_EXECUTE } from '../contract/sessionExecute'
import { ClaudeAgentDriver } from '../main/drivers/claudeDriver'
import { CodexAgentDriver } from '../main/drivers/codexDriver'
import { agentDriverRegistry } from '../main/drivers/registry'
import { readAgentPricingPreferences, writeAgentPricingPreferences } from '../main/pricingStore'
import { ManagedAgentRuntime } from '../main/runtime'
import { AGENTS_RUNTIME } from '../contract/runtime'
import { createSessionExecute } from '../main/sessionExecute'
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

// Guards against a duplicate-registration error, not per-boot state: `apps/node/src/service/runtime.test.ts`
// starts the runtime several times in one process (docs/plugins.md § Collaboration rules), and the driver
// registry throws on a repeat id. A driver factory is stateless, so nothing else needs resetting between
// boots.
let driversRegistered = false
function registerBuiltInDrivers(): void {
  if (driversRegistered) return
  driversRegistered = true
  agentDriverRegistry.register('claude', () => new ClaudeAgentDriver())
  agentDriverRegistry.register('codex', () => new CodexAgentDriver())
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
  return {
    name: 'agents',
    required: true,
    // docs/data-layer.md § Migrations: this plugin's migration chain, opened and closed by the host.
    migrationsModule: import.meta.url,
    init: (ctx) => {
      registerBuiltInProfiles()
      registerBuiltInDrivers()
      // Migrated before init returns, so no request or provider spawn can reach an unmigrated
      // database. See docs/data-layer.md § Migrations, which also covers the hand-written
      // `agent_events_fts` triggers (node/schema.ts).
      const store = ctx.storage.open()
      const core = ctx.core

      runtime = new ManagedAgentRuntime({
        db: store,
        dataDir,
        core,
        internalEnv: deps.internalEnv,
        secrets: core.secrets,
        // Read per call, never captured: creating a task's worktree consults that owner's per-repo
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
        // The return path of the same handoff. `false` when the terminal plugin is absent is the right
        // answer, not a degradation: with no PTY engine there is no shell holding the session, so
        // control can come back to Acorn.
        terminalHandoffRunning: async (sessionId) => {
          const sessions = ctx.capabilities.get(TERMINAL_SESSIONS)
          if (!sessions) return false
          return (await sessions.list()).some((terminal) =>
            terminal.agentSessionId === sessionId && terminal.status === 'running')
        },
        onCompletedTurn: deps.memoryReviewTrigger,
      })

      managedRoute = ctx.capabilities.provide(MANAGED_AGENTS, managedAgentsBridge(runtime))
      // Local provider usage (the CLI plan probes) plus the pricing overrides it costs against. The
      // probe directory is under the data root, beside the plugin's SQLite file, and the pricing read
      // goes through `CoreServices.prefs` because `prefs` is core's table (main/pricingStore.ts).
      usageRoute = ctx.capabilities.provide(AGENT_USAGE, {
        ...createAgentUsageService({
          probeDir: join(dataDir, 'agent-usage-probe'),
          pricingForUser: (userId) => readAgentPricingPreferences(core.prefs, userId),
        }),
        pricing: (userId) => readAgentPricingPreferences(core.prefs, userId),
        setPricing: (userId, preferences) => writeAgentPricingPreferences(core.prefs, userId, preferences),
      })

      ctx.routes.register(managedAgents, { prefix: '', note: 'managed agent sessions, turns, attachments, artifacts' })
      ctx.routes.register(agentUsage, { prefix: '', note: '/usage, /pricing — account-scoped provider usage' })

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
          // Nothing to collect against: a node with no bound owner has no pricing preferences to cost
          // the usage with, and inventing an empty owner would cache a snapshot under the wrong key.
          if (!userId) return 'no owner is bound to this node yet'
          const snapshot = await ctx.capabilities.require(AGENT_USAGE).read({ userId, force: true })
          return `${snapshot.providers.filter((provider) => !provider.error).length} of ${snapshot.providers.length} providers answered`
        },
      })

      // agents.sessionExecute (contract/sessionExecute.ts). The workflow runner resolves this at call
      // time and falls back to its own headless runner when it is absent, so a node with this plugin
      // unavailable still runs non-managed workflow steps.
      ctx.capabilities.provide(AGENTS_SESSION_EXECUTE, createSessionExecute(runtime))
      // reconcile() runs from the composition root, not here, for the same reason workflows' does
      // (contract/runtime.ts): it must run after the listener binds and it interrupts every unsettled
      // session.
      ctx.capabilities.provide(AGENTS_RUNTIME, { reconcile: () => runtime!.reconcile() })
    },
    // Releases what init acquired, in the order docs/managed-agents.md § Operations and failure
    // describes.
    dispose: async () => {
      await runtime?.stop()
      runtime = null
      managedRoute?.dispose()
      usageRoute?.dispose()
      for (const dispose of builtInProfileDisposables ?? []) dispose()
      builtInProfileDisposables = null
    },
  }
}
