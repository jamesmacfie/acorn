import type { InternalEnvFactory } from '@acorn/node-core/server/auth/internalTokens.ts'
import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { openPluginDb } from '@acorn/node-core/main/pluginStorage.ts'
import { getProfile, resolveCommand } from '@acorn/node-core/main/profiles.ts'
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
import { migrationsDir } from './migrations'
import { aiderProfile, claudeCodeProfile, codexProfile } from '../main/index'
import { agentProfileRegistry } from '@acorn/node-core/main/agentProfiles/index.ts'

let builtInProfileDisposables: (() => void)[] | null = null
export function registerBuiltInProfiles(): void {
  if (builtInProfileDisposables) return
  builtInProfileDisposables = [claudeCodeProfile, codexProfile, aiderProfile].map((profile) => agentProfileRegistry.register(profile))
}

// Registered once per PROCESS, not once per boot. The driver registry is a module singleton whose
// `register` throws on a duplicate id, and apps/node/src/service/runtime.test.ts starts the runtime four
// times in one process — which is exactly the shape of bug the capability and route registries were both
// made per-runtime to avoid. Guarding here is the cheaper fix: a driver factory is stateless (it returns
// a fresh driver per session), so there is nothing per-boot for it to hold.
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
  // Mints the per-session loopback credential every provider child runs under. It stays an app-supplied
  // dep for the same stated reason plugins/terminal's does: it closes over the listener's ORIGIN, which
  // does not exist until after every plugin's init has run, and over INTERNAL_TOKEN — the signing KEY.
  // Putting that on CoreServices would let any plugin mint a token for any scope, which is the opposite
  // of what scoping the tokens bought. The engine calls it per session start with
  // `{ scope: 'task', taskId, sessionId }`, so each agent gets a credential bound to its own task.
  internalEnv: InternalEnvFactory
  memoryReviewTrigger?: (taskId: string, transcriptTail: string) => Promise<void>
}

export const agentsPlugin = (dataDir: string, deps: AgentsPluginDeps): NodePlugin => {
  let db: ReturnType<typeof openPluginDb> | null = null
  let runtime: ManagedAgentRuntime | null = null
  let managedRoute: { dispose(): void } | null = null
  let usageRoute: { dispose(): void } | null = null
  return {
    name: 'agents',
    required: true,
    init: (ctx) => {
      registerBuiltInProfiles()
      registerBuiltInDrivers()
      // Opened and migrated before the listener binds: the runtime below closes over the handle and
      // fills both bridges in this same call, so no request and no provider spawn can reach an
      // unmigrated database. This chain also creates `agent_events_fts` and its three triggers by hand
      // — drizzle-kit cannot model a virtual table (node/schema.ts).
      db = openPluginDb(dataDir, 'agents', { migrationsFolder: migrationsDir() })
      const store = db
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

      // agents.sessionExecute (contract/sessionExecute.ts). The workflow runner resolves this at call
      // time and falls back to its own headless runner when it is absent, so a node with this plugin
      // unavailable still runs non-managed workflow steps.
      ctx.capabilities.provide(AGENTS_SESSION_EXECUTE, createSessionExecute(runtime))
      // reconcile() is NOT called here, for the same reason workflows' is not: it has to run AFTER the
      // listener binds (a resumed session's tools call the node's own loopback surface) and it sweeps
      // every unsettled session, so the composition root drives it through this capability.
      ctx.capabilities.provide(AGENTS_RUNTIME, { reconcile: () => runtime!.reconcile() })
    },
    // Everything init reached out and touched, in reverse. The runtime's stop() is the load-bearing part
    // and it does four things a second boot in one process would otherwise inherit: cancel the pending
    // provider-reconnect timers, stop every live provider child, flush the durable event buffer's
    // per-session timers, and stop the webhook delivery pump. Only then is the WAL-mode SQLite file
    // closed — the composition root's teardown invariant, and here also the ordering that keeps the
    // final transcript rows durable, since every step above may still write one.
    //
    // The two bridge slots are cleared explicitly rather than trusting teardown order: without that, a
    // second startServiceRuntime in one process would serve agent requests through the first boot's
    // closed database handle.
    dispose: async () => {
      await runtime?.stop()
      runtime = null
      managedRoute?.dispose()
      usageRoute?.dispose()
      for (const dispose of builtInProfileDisposables ?? []) dispose()
      builtInProfileDisposables = null
      db?.close()
      db = null
    },
  }
}
