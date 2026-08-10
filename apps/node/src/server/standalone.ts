// The Electron-free entry for `pnpm dev:node` and the packaged standalone Node. It initializes the
// plugin graph, wires the pure-Node domain bridges, and starts the loopback HTTPS listener over a data
// root. Under Electron this path is not taken; desktop main owns boot and supplies native bridges.
//
// Once listening it prints ONE line of JSON holding everything a client needs to reach it, pin it and
// authenticate to it. That handshake is not a convenience: the port is ephemeral now
// (main/serverConfig.ts), so a parent process — the two-node e2e today, a launchd/systemd wrapper
// later — cannot guess the endpoint, and the self-signed certificate has no CA to vouch for it.
// Everything else this process logs is free-form; this line is the contract.
// These pure-Node composition hooks register agent profiles, core agent tools, and config-trust
// behavior before the listener binds. Desktop-only capabilities are supplied separately by Electron
// main; this entry supplies explicit headless adapters where a plugin still needs one.
import { join } from 'node:path'
import { closeListener, devDataDir, makeRuntime, startListener } from '@acorn/node-core/main/server.ts'
import { advertisedHosts, confirmAdvertiseHost } from '@acorn/node-core/main/advertise.ts'
import { openDataRoot } from '@acorn/node-core/main/dataRoot.ts'
import { fingerprintPhrase } from '@acorn/protocol/fingerprintWords.ts'
import { pruneAudit } from '@acorn/node-core/server/audit.ts'
import { resolveDeviceToken } from '@acorn/node-core/server/auth/deviceTokens.ts'
import { mintInternalToken, type InternalEnvFactory } from '@acorn/node-core/server/auth/internalTokens.ts'
import { createCoreServices } from '@acorn/node-core/main/core/index.ts'
import { disabledPluginsStore } from '@acorn/node-core/main/disabledPlugins.ts'
import { PLUGIN_STATE } from '@acorn/node-core/server/routes/plugins.ts'
import { installPlugin, uninstallPlugin, updatePlugin } from '@acorn/node-core/main/pluginInstaller.ts'
import { installedPluginInfo, readClientBundle, scanInstalled } from '@acorn/node-core/main/pluginLoader.ts'
import { CapabilityRegistry } from '@acorn/node-core/server/plugin/capabilities.ts'
import { initPlugins } from '@acorn/node-core/server/plugin/host.ts'
import { wireAgentTools } from '@acorn/node-core/server/agentTools/coreTools.ts'
import { buildPluginDeps } from './pluginDeps'
import { assembleNodeGraph, drainNode, reconcileNode } from './composition'
import { setWorktreesRoot } from '@acorn/node-core/main/taskWorktree.ts'
import type { BrowserDesktopCapability } from '@acorn/protocol/desktopCapabilities.ts'

// ACORN_DATA_DIR names the root explicitly. It is the same variable this node hands its own child
// processes (service/runtime.ts's internalApiEnv), so one spelling of "which root" covers the whole
// tree of processes. Unset means the repo-local dev root, which is what `dev:node` wants.
//
// Opening it takes the root's exclusive lock, so a standalone node and a running desktop app refuse to
// share one root explicitly instead of racing over SQLite.
const root = openDataRoot(process.env.ACORN_DATA_DIR || devDataDir())
// Asked before anything else prints, and only on a first boot at a real terminal: the answer decides
// whether the listener binds beyond loopback, and burying that question under two screens of plugin
// boot output would be a good way to have nobody read it. Silent under a service manager
// (main/advertise.ts).
await confirmAdvertiseHost(root)
const capabilities = new CapabilityRegistry()
const runtime = makeRuntime(root, undefined, capabilities)
const disabledPlugins = disabledPluginsStore(root.dir)
await runtime.IDEMPOTENCY.cleanupExpired() // reclaim yesterday's replay rows; see service/runtime.ts
// Audit retention is enforced at boot so the append-only audit table remains bounded.
await pruneAudit(runtime.DB).catch((error) => console.warn('[node] audit prune failed:', error))
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
const core = createCoreServices({ secrets: runtime.SECRETS, db: runtime.DB, activeIdentity: runtime.ACTIVE_IDENTITY, capabilities })

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

// The standalone and Electron roots activate the same plugin list, through the same builder. Their
// behavior differs only where the available runtime bridge does — here, the preview browser.
const graph = await assembleNodeGraph(root.dir, buildPluginDeps({ capabilities, core, internalEnv, reconciled, browser: unavailableBrowser }))
const plugins = await initPlugins(
  graph.plugins,
  // Plugin disablement is stored by the Node itself. The desktop fleet file controls the client view,
  // while this persisted set controls a standalone process at boot.
  { capabilities, core, disabled: disabledPlugins.get(), loaded: graph.loaded },
)
// A standalone node has no packaging flag to consult, so NODE_ENV is the only development signal it
// has. It gates one thing: `{ path }` installs, which symlink an author's working tree into the install
// directory (docs/plugins.md).
const devBuild = process.env.NODE_ENV !== 'production'
const pluginStateCapability = capabilities.provide(PLUGIN_STATE, {
  roster: () => plugins.roster,
  // Re-scanned per call, not the boot snapshot: an install has to show up in the roster before the
  // restart that runs it, and the device fetches its bundle from that same row to ask about it.
  installed: () => scanInstalled(root.dir).installed.map(installedPluginInfo),
  booted: () => graph.installed.map((entry) => ({ id: entry.manifest.id, version: entry.manifest.version })),
  clientBundle: (id) => readClientBundle(scanInstalled(root.dir).installed, id),
  disabled: () => disabledPlugins.get(),
  setDisabled: (names) => disabledPlugins.set(names),
  install: (source, options) => installPlugin(root.dir, source, { ...options, allowLocalPath: devBuild }),
  update: (id, options) => updatePlugin(root.dir, id, { ...options, allowLocalPath: devBuild }),
  uninstall: (id, options) => uninstallPlugin(root.dir, id, options),
})

// Core's own six agent tools and the config-trust bridge, matching service/runtime.ts. Both are pure
// functions over the database; neither needs a window.
wireAgentTools({ db: runtime.DB })

// Awaited, not fire-and-forget: there is nothing to hand back until the listener has bound, and a
// listen failure now exits non-zero with its reason instead of leaving a process alive that answers
// nothing.
const listener = await startListener(runtime, root)
apiUrl = listener.endpoint.origin

// Re-attach sessions, repair worktree state, and sweep workflow/agent records through the same
// post-listener sequence as the supervised root. The listener is already live because resumed work
// calls the Node's own authenticated routes.
const reconcileTask = reconcileNode({ db: runtime.DB, dataDir: root.dir, capabilities }).finally(() => finishReconcile())
await reconcileTask

// Counted BEFORE the handshake below, which issues a launcher device of its own when
// ACORN_DEVICE_TOKEN is unset — after it, every node looks paired.
const alreadyPaired = (await runtime.DEVICES.list()).filter((device) => device.revokedAt === null).length

// SIGINT and SIGTERM close the listener first, dispose plugins, close SQLite, and release the
// data-root lock. The ordered drain is bounded so shutdown cannot hang indefinitely on one plugin.
let stopping = false
const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (stopping) return
  stopping = true
  console.log(`[node] ${signal} — draining`)
  const outcome = await drainNode({
    listener: () => closeListener(listener.server),
    reconciliation: async () => await reconcileTask,
    pluginState: async () => pluginStateCapability.dispose(),
    plugins: () => plugins.dispose(),
    sqlite: async () => runtime.DB.close(),
    dataRoot: async () => root.release(),
  })
  if (outcome === 'timeout') console.warn('[node] drain exceeded its deadline; exiting anyway')
  process.exit(0)
}

// Signals are wired BEFORE anything announces readiness, and the order is load-bearing rather than
// tidy. Until `process.once('SIGTERM')` runs, SIGTERM still has its default disposition, so the
// kernel kills the process outright — no drain, no lock release, exit status "killed by signal". A
// supervisor (or the shutdown integration test) acts the instant it sees the handshake line, so
// anything printed before this point is an invitation to be killed mid-boot.
//
// SIGUSR1 reopens a pairing window. A signal rather than a route or a flag: it needs no token (the
// pairing route requires one, which is the credential you do not have yet), no second port, and it
// demands shell access on this machine — the same "the owner is present" property the pairing window
// is built on. Restarting to get a code would kill every live agent and terminal session this node
// is hosting.
process.on('SIGUSR1', () => printPairingBanner(runtime.PAIRING_CODES.issue()))
process.once('SIGINT', (signal) => void shutdown(signal))
process.once('SIGTERM', (signal) => void shutdown(signal))

console.log(
  JSON.stringify({
    nodeId: root.nodeId,
    endpoint: listener.endpoint.origin,
    fingerprint: listener.fingerprint,
    certPem: listener.certPem,
    deviceToken: await resolveDeviceToken(runtime.DEVICES, process.env.ACORN_DEVICE_TOKEN, 'Standalone node launcher'),
  }),
)

// The terminal this was started from IS the out-of-band channel pairing depends on: the owner compares
// the identity words here against the ones the client shows, and that comparison is the whole security
// of pairing (docs/api-reference.md § Pairing). Printing it is what turns pairing from "read a device
// token out of a JSON blob and curl the code route" into copy, compare, paste.
//
// A code is opened automatically only while nothing is paired yet, so a restart of a working node does
// not leave a live window nobody asked for. It is no more sensitive than the device token the
// handshake line above already prints — that one does not expire.
function printPairingBanner(code: string | null): void {
  const port = listener.endpoint.port
  const reachable = advertisedHosts(root).map((host) => `https://${host}:${port}`)
  console.log('')
  console.log('  acorn node ready')
  console.log('')
  if (reachable.length > 0) console.log(`    Connect to    ${reachable.join('\n                  ')}`)
  else console.log(`    Connect to    https://127.0.0.1:${port}  (this machine only)`)
  console.log(`    Identity      ${fingerprintPhrase(listener.fingerprint) ?? listener.fingerprint}`)
  if (code) console.log(`    Pairing code  ${code}   (valid 10 minutes)`)
  console.log('')
  if (code) {
    console.log('  In acorn: Settings → Nodes → add a node. Paste the address, check the identity')
    console.log('  words match what acorn shows you, then paste the code.')
  } else {
    console.log(`  ${alreadyPaired} device(s) already paired. For another, run:  kill -USR1 ${process.pid}`)
  }
  if (reachable.length === 0) {
    console.log('  To reach this node from another machine, set advertiseHost in this data root\'s')
    console.log('  node.json (or ACORN_ADVERTISE_HOST) and restart.')
  }
  console.log('')
}

printPairingBanner(alreadyPaired === 0 ? runtime.PAIRING_CODES.issue() : null)

