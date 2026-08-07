// The Electron-free entry: `pnpm dev:node` from a checkout, and the standalone node a client pairs
// with over the LAN (docs/vNext/plan.md § Phase 5, "standalone node distribution" — this is the down
// payment on it). It is a composition root: it initializes the plugin graph (which is what registers the
// built-in integration providers now), wires the
// pure-Node domain bridges, then starts the HTTPS listener over a data root. Under Electron this path
// is never taken — apps/desktop's main/bootstrap.ts owns boot and installs the stateful bridges too.
//
// Once listening it prints ONE line of JSON holding everything a client needs to reach it, pin it and
// authenticate to it. That handshake is not a convenience: the port is ephemeral now
// (main/serverConfig.ts), so a parent process — the two-node e2e today, a launchd/systemd wrapper
// later — cannot guess the endpoint, and the self-signed certificate has no CA to vouch for it.
// Everything else this process logs is free-form; this line is the contract.
import './routes' // register plugin-owned HTTP routers into the core route registry
// The three app-layer wirings the supervised root does, and this entry did NOT — which was a real gap
// rather than a deliberate omission, and it is the one that made "a remote task's agent works over the
// LAN" untrue. All three are pure Node and need no DesktopCapabilities:
//
//   - `agentProfiles` registers claude / codex / aider into core's profile registry. Without it a remote
//     node offered only core's shell profile, so launching an agent on it had nothing to launch.
//   - `wireAgentTools` registers core's own six tools. Without it an agent on a remote node saw a
//     six-tool-smaller MCP surface than the same agent on the local one — the same class of silent
//     divergence as the `issues` context section Phase 3 found on this exact path.
//   - `wireConfigTrust` fills the config-trust bridge, without which
//     `/v2/core/tasks/:id/config-trust` answered 503 and a remote task could never acknowledge its repo
//     config — so every gated workflow and executable config on that node stayed unusable.
import '../wiring/agentProfiles'
import { join } from 'node:path'
import { devDataDir, makeRuntime, startListener } from '@acorn/node-core/main/server.ts'
import { openDataRoot } from '@acorn/node-core/main/dataRoot.ts'
import { resolveDeviceToken } from '@acorn/node-core/server/auth/deviceTokens.ts'
import { mintInternalToken, type InternalEnvFactory } from '@acorn/node-core/server/auth/internalTokens.ts'
import { createCoreServices } from '@acorn/node-core/main/core/index.ts'
import { disabledPluginsStore } from '@acorn/node-core/main/disabledPlugins.ts'
import { setPluginsBridge } from '@acorn/node-core/server/routes/plugins.ts'
import { CapabilityRegistry } from '@acorn/node-core/server/plugin/capabilities.ts'
import { initPlugins } from '@acorn/node-core/server/plugin/host.ts'
import { setWorktreesRoot } from '@acorn/node-core/main/taskWorktree.ts'
import { AGENTS_RUNTIME } from '@acorn/plugin-agents/main/runtime.ts'
import { MEMORY_KNOWLEDGE } from '@acorn/plugin-memory/main/knowledgeIpc.ts'
import { NOTES_STORE } from '@acorn/plugin-notes/contract/store.ts'
import { seedTaskNotes } from '@acorn/plugin-notes/main/seedTaskNotes.ts'
import { reconcileTmux } from '@acorn/plugin-terminal/main/terminal.ts'
import { WORKFLOWS_RUNNER } from '@acorn/plugin-workflows/main/workflowRunner.ts'
import { GITHUB_MIRROR } from '@acorn/plugin-github/contract/mirror.ts'
import { wireAgentTools } from '../wiring/agentToolsWiring'
import { wireConfigTrust } from '../wiring/configTrustWiring'
import { nodePlugins } from './plugins'
import type { BrowserDesktopCapability } from '@acorn/protocol/desktopCapabilities.ts'

// ACORN_DATA_DIR names the root explicitly. It is the same variable this node hands its own child
// processes (service/runtime.ts's internalApiEnv), so one spelling of "which root" covers the whole
// tree of processes. Unset means the repo-local dev root, which is what `dev:node` wants.
//
// Opening it takes the root's exclusive lock, so a standalone node and a running desktop app refuse to
// share one root explicitly instead of racing over SQLite.
const root = openDataRoot(process.env.ACORN_DATA_DIR || devDataDir())
const runtime = makeRuntime(root)
const disabledPlugins = disabledPluginsStore(root.dir)
await runtime.IDEMPOTENCY.cleanupExpired() // reclaim yesterday's replay rows; see service/runtime.ts
setWorktreesRoot(join(root.dir, 'worktrees'))

// The same deps the supervised composition root supplies (service/runtime.ts explains why each one
// cannot be a capability). A standalone node now runs a REAL terminal engine rather than leaving the PTY
// bridge unfilled at 503: `terminal` is a `required` plugin, and a required plugin ignoring the disabled
// list is the whole point of the flag — a node that answers /v2/core/tasks/:id/archive has to be able to
// see that task's live sessions.
let apiUrl = ''
const internalEnv: InternalEnvFactory = (claims) => ({
  ACORN_API_URL: apiUrl,
  ACORN_API_TOKEN: mintInternalToken(runtime.INTERNAL_TOKEN, claims),
  ACORN_DATA_DIR: root.dir,
  NODE_EXTRA_CA_CERTS: join(root.dir, 'tls', 'cert.pem'),
})
let finishReconcile!: () => void
const reconciled = new Promise<void>((resolve) => (finishReconcile = resolve))
const capabilities = new CapabilityRegistry()
// Resolved at CALL time, never here: `memory.knowledge` is published by memory's init, which has not run
// when this object is built, and terminal may not import it (see service/runtime.ts).
const knowledgeAt = () => capabilities.require(MEMORY_KNOWLEDGE)
const notesAt = () => capabilities.require(NOTES_STORE)
const core = createCoreServices({ secrets: runtime.SECRETS, db: runtime.DB })

// Every method rejects identically: there is no window on a standalone node, so there is nothing to drive.
// A rejection rather than a silent empty result, because an agent that asked for a snapshot and got nothing
// back cannot tell "the page is blank" from "there is no browser".
const browserUnavailable = () => Promise.reject(new Error('The preview browser needs a desktop window; this node is running headless.'))
const unavailableBrowser: BrowserDesktopCapability = {
  navigate: browserUnavailable,
  snapshot: browserUnavailable,
  click: browserUnavailable,
  fill: browserUnavailable,
  screenshot: browserUnavailable,
  console: browserUnavailable,
}

// Converted plugins register their own routes and open their own SQLite files here. A standalone node
// runs the SAME list as the supervised one — the difference is only which engine bridges get filled,
// so a plugin that needs no DesktopCapabilities works identically over the LAN.
const plugins = await initPlugins(
  nodePlugins(root.dir, {
    // A standalone node runs the managed agent runtime too, which is another BEHAVIOUR CHANGE of the same
    // kind as the workflow one below: this entry never wired managed agents, so `dev:node` answered a flat
    // 503 for every /v2/p/agents/sessions* route. `agents` is a `required` plugin, so it serves them now.
    agents: {
      internalEnv,
      currentUserId: () => runtime.ACTIVE_IDENTITY.get(),
      memoryReviewTrigger: (taskId, transcriptTail) => knowledgeAt().memoryReviewTrigger(taskId, transcriptTail),
    },
    memory: { currentUserId: () => runtime.ACTIVE_IDENTITY.get() },
    // A standalone node has no BrowserWindow, so the six `browser_*` tools preview contributes cannot work
    // here. They are still REGISTERED — the tool manifest must be the same shape on every node, or an agent
    // would see a different surface depending on how its node was started — and each one rejects with a
    // clear reason instead of pretending to drive a webview that does not exist. That is the same degraded
    // shape `dev:node` already has for anything needing native UI.
    preview: { browser: unavailableBrowser },
    terminal: {
      internalEnv,
      launchInjector: (taskId, sessionId) => knowledgeAt().launchInjector(taskId, sessionId),
      memoryReviewTrigger: (taskId, transcriptTail) => knowledgeAt().memoryReviewTrigger(taskId, transcriptTail),
      seedTaskNotes: (task) => seedTaskNotes(core, notesAt(), internalEnv({ scope: 'service' }), task),
      reconciled,
    },
    // A standalone node now runs the workflow engine too, which is a BEHAVIOUR CHANGE: this entry never
    // called registerWorkflowIpc, so `dev:node` answered a flat 503 for every workflow route. It serves
    // them now, on the same terms as the supervised root — including the github-mirror CI read, which is
    // that plugin's own capability, resolved at call time.
    workflows: {
      internalEnv,
      reconciled,
      currentUserId: () => runtime.ACTIVE_IDENTITY.get(),
      memoryReviewTrigger: (taskId, transcriptTail) => knowledgeAt().memoryReviewTrigger(taskId, transcriptTail),
      failingChecks: async (taskId) =>
        (await capabilities.get(GITHUB_MIRROR)?.failingChecks(runtime.ACTIVE_IDENTITY.get(), taskId)) ?? null,
    },
  }),
  // The same per-node file the supervised root reads (main/disabledPlugins.ts). It matters MORE here:
  // this is the entry a remote node boots from, and a client's fleet file has no say in a launchd start,
  // so this file is the only place a "disable docker on the build box" setting could live.
  { capabilities, core, disabled: disabledPlugins.get() },
)
setPluginsBridge({
  roster: () => plugins.roster,
  disabled: () => disabledPlugins.get(),
  setDisabled: (names) => disabledPlugins.set(names),
})

// Core's own six agent tools and the config-trust bridge, matching service/runtime.ts. Both are pure
// functions over the database; neither needs a window.
wireAgentTools({ db: runtime.DB })
wireConfigTrust(runtime.DB)

// Awaited, not fire-and-forget: there is nothing to hand back until the listener has bound, and a
// listen failure now exits non-zero with its reason instead of leaving a process alive that answers
// nothing.
const listener = await startListener(runtime, root)
apiUrl = listener.endpoint.origin

// Re-attach surviving tmux sessions before anything can archive a task. Skipping it would leave the
// archive route's running-session guard passing vacuously against an empty session map — the exact
// failure mode TaskSessionsBridge.ready() exists to prevent.
try {
  await reconcileTmux()
} catch (error) {
  console.warn('[node] tmux reconcile failed:', error)
}
// Before finishReconcile(), like the supervised root: the sweep re-queues every 'running' step, and
// start/gate/cancel await that promise precisely so a run cannot be started into it.
try {
  await capabilities.get(WORKFLOWS_RUNNER)?.reconcile()
} catch (error) {
  console.warn('[node] workflow reconcile failed:', error)
}
// The agent sweep: interrupt every turn that was active when this node last exited, expire its pending
// requests, collect orphaned attachments and re-arm webhook delivery. After the listener binds, because a
// resumed session's tools call the node's own loopback surface.
try {
  await capabilities.require(AGENTS_RUNTIME).reconcile()
} catch (error) {
  console.warn('[node] managed agent reconcile failed:', error)
} finally {
  finishReconcile()
}

console.log(
  JSON.stringify({
    nodeId: root.nodeId,
    endpoint: listener.endpoint.origin,
    fingerprint: listener.fingerprint,
    certPem: listener.certPem,
    deviceToken: await resolveDeviceToken(runtime.DEVICES, process.env.ACORN_DEVICE_TOKEN, 'Standalone node launcher'),
  }),
)

// Ctrl-C is how `dev:node` ends, so it is the ONLY teardown path this entry has — and it had none.
// Eight plugins own WAL-mode SQLite files now and the data root holds an exclusive pidfile lock, so
// exiting without this left journals unflushed and the lock held, which the next `dev:node` refuses to
// take. The supervised root has done this since Phase 1 (service/runtime.ts's stop()); this entry simply
// never grew the equivalent, and the plugin conversions are what made it matter.
//
// Same order as the supervised root, for the same reason: plugins before core's database, core's database
// before the root lock, because a restart must not open a database this process still holds a WAL for.
let stopping = false
const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (stopping) return
  stopping = true
  console.log(`[node] ${signal} — draining`)
  for (const [label, step] of [
    ['plugins', () => plugins.dispose()],
    ['sqlite', async () => runtime.DB.close()],
    ['data root', async () => root.release()],
  ] as const) {
    try {
      await step()
    } catch (error) {
      console.warn(`[node] ${label} teardown failed:`, error)
    }
  }
  process.exit(0)
}
process.once('SIGINT', (signal) => void shutdown(signal))
process.once('SIGTERM', (signal) => void shutdown(signal))
