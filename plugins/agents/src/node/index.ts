// The agents plugin's node part (docs/vNext/plugins.md § The plugin API).
//
// The largest conversion in Phase 2 by table count, and the last one with real cross-database joins.
// What the composition root used to do by hand:
//
//   - apps/node/src/wiring/managedAgentsWiring.ts (~130 lines) registered the two built-in drivers,
//     constructed ManagedAgentRuntime over CORE's database handle, defined the agent→terminal handoff by
//     reaching into `terminalBridgeSlot`, wrapped 27 runtime methods into the ManagedAgentsBridge with a
//     shared error taxonomy, and published `agents.sessionExecute`. All of it is here now except the
//     bridge's error mapping, which stayed beside the routes it produces status codes for.
//   - apps/node/src/wiring/serverBridges.ts filled the agent-usage bridge. It was one bridge from empty
//     and its own comment said to DELETE it rather than keep an empty hook; that is what happened.
//   - apps/node/src/server/routes.ts registered both routers.
//   - apps/node/src/service/runtime.ts held the runtime handle so teardown could call stop(), and drove
//     reconcile() after the listener bound.
//   - @acorn/node-core's schema.ts owned ten `agent_*` tables plus the hand-written `agent_events_fts`
//     virtual table and its three triggers.
//
// `required: true`, for the reason plugins.md gives for github/terminal/agents: the Agent Center is a
// primary surface, the workflow runner resolves `agents.sessionExecute` for every managed step, and a
// node with this off would boot and then fail at the first agent session. Note the consequence for
// `dev:node`, which never wired managed agents at all: a standalone node now runs the full agent
// runtime instead of answering 503 on /v2/p/agents/sessions*. That is a behaviour change, deliberately,
// on the same terms as terminal's and workflows' were.
import type { InternalEnvFactory } from '@acorn/node-core/server/auth/internalTokens.ts'
import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { openPluginDb } from '@acorn/node-core/main/pluginStorage.ts'
import { getProfile, resolveCommand } from '@acorn/node-core/main/profiles.ts'
import { wsBroadcast } from '@acorn/node-core/main/wsHub.ts'
import { TERMINAL_SESSIONS } from '@acorn/plugin-terminal/contract/sessions.ts'
import { join } from 'node:path'
import { AGENTS_SESSION_EXECUTE } from '../contract/sessionExecute'
import { ClaudeAgentDriver } from '../main/drivers/claudeDriver'
import { CodexAgentDriver } from '../main/drivers/codexDriver'
import { agentDriverRegistry } from '../main/drivers/registry'
import { readAgentPricingPreferences, writeAgentPricingPreferences } from '../main/pricingStore'
import { AGENTS_RUNTIME, ManagedAgentRuntime } from '../main/runtime'
import { createSessionExecute } from '../main/sessionExecute'
import { createAgentUsageService } from '../main/usage/service'
import { managedAgents, setManagedAgentsBridge } from '../server/routes/managed'
import { managedAgentsBridge } from '../server/routes/managedBridge'
import { agentUsage, setAgentUsageBridge } from '../server/routes/usage'
import { migrationsDir } from './migrations'

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

// The two things this plugin still cannot resolve for itself.
export type AgentsPluginDeps = {
  // Mints the per-session loopback credential every provider child runs under. It stays an app-supplied
  // dep for the same stated reason plugins/terminal's does: it closes over the listener's ORIGIN, which
  // does not exist until after every plugin's init has run, and over INTERNAL_TOKEN — the signing KEY.
  // Putting that on CoreServices would let any plugin mint a token for any scope, which is the opposite
  // of what scoping the tokens bought. The engine calls it per session start with
  // `{ scope: 'task', taskId, sessionId }`, so each agent gets a credential bound to its own task.
  internalEnv: InternalEnvFactory
  // plugins/memory's auto-generation trigger, fired when a turn completes. A thunk supplied by the
  // composition root because `memory.knowledge`'s capability id deliberately lives in that plugin's
  // main/ rather than a contract/ (its value exposes two internal stores), so importing it here would
  // ADD an agents→memory coupling edge to the ledger Phase 3 exists to shrink.
  memoryReviewTrigger?: (taskId: string, transcriptTail: string) => Promise<void>
  // The node's active GitHub identity, which lives in the runtime bindings — not on CoreServices, and
  // not something a plugin should be able to set. Read per call: creating a task's worktree consults
  // that owner's per-repo `base_ref` preference.
  currentUserId(): string | null
}

export const agentsPlugin = (dataDir: string, deps: AgentsPluginDeps): NodePlugin => {
  let db: ReturnType<typeof openPluginDb> | null = null
  let runtime: ManagedAgentRuntime | null = null
  return {
    name: 'agents',
    required: true,
    init: (ctx) => {
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
        currentUserId: deps.currentUserId,
        publish: (frame) => wsBroadcast(frame),
        // Hand a provider session over to a real shell. Resolved through `terminal.sessions` at CALL
        // time, never at init: plugin init order is undefined, so resolving here could capture
        // `undefined` purely because terminal is declared after agents in the plugin list. It used to
        // read `terminalBridgeSlot` from the app, which a plugin may not do — the slot is another
        // plugin's route wiring, and importing it would turn a client-only ledger edge into a node one.
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

      setManagedAgentsBridge(managedAgentsBridge(runtime))
      // Local provider usage (the CLI plan probes) plus the pricing overrides it costs against. The
      // probe directory is under the data root, beside the plugin's SQLite file, and the pricing read
      // goes through `CoreServices.prefs` because `prefs` is core's table (main/pricingStore.ts).
      setAgentUsageBridge({
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
      setManagedAgentsBridge(null)
      setAgentUsageBridge(null)
      db?.close()
      db = null
    },
  }
}
