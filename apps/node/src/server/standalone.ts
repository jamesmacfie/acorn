// The Electron-free entry for `pnpm dev:node` and the packaged standalone Node
// (docs/node-distribution.md). See docs/architecture-overview.md § Runtime topology for how this
// differs from the Electron-supervised root.
import { join } from 'node:path'
import { closeListener, devDataDir, makeRuntime, startListener } from '@acorn/node-core/main/server.ts'
import { advertisedHosts, confirmAdvertiseHost } from '@acorn/node-core/main/advertise.ts'
import { openDataRoot } from '@acorn/node-core/main/dataRoot.ts'
import { fingerprintPhrase } from '@acorn/protocol/fingerprintWords.ts'
import { NODE_PROTOCOL_VERSION } from '@acorn/protocol/node.ts'
import { createScheduler, SCHEDULER } from '@acorn/node-core/server/schedules/index.ts'
import { resolveDeviceToken } from '@acorn/node-core/server/auth/deviceTokens.ts'
import { mintInternalToken, type InternalEnvFactory } from '@acorn/node-core/server/auth/internalTokens.ts'
import { createCoreServices } from '@acorn/node-core/main/core/index.ts'
import { disabledPluginsStore } from '@acorn/node-core/main/disabledPlugins.ts'
import { PLUGIN_STATE } from '@acorn/node-core/server/plugin/pluginState.ts'
import { CapabilityRegistry } from '@acorn/node-core/server/plugin/capabilities.ts'
import { initPlugins } from '@acorn/node-core/server/plugin/host.ts'
import { wireAgentTools } from '@acorn/node-core/server/agentTools/coreTools.ts'
import { buildPluginDeps } from './pluginDeps'
import { buildPluginStateBridge, effectiveDisabled } from './pluginState'
import { assembleNodeGraph, drainNode, reconcileBundledPackages, reconcileNode } from './composition'
import { setWorktreesRoot } from '@acorn/node-core/main/taskWorktree.ts'
import type { BrowserDesktopCapability } from '@acorn/protocol/desktopCapabilities.ts'

// ACORN_DATA_DIR names the data root (docs/data-layer.md § Data root); service/runtime.ts's
// internalApiEnv hands this node's own child processes the same variable, so one spelling of "which
// root" covers the whole process tree. Opening it takes the root's exclusive lock, which is why a
// standalone node and a running desktop app cannot share one.
const root = openDataRoot(process.env.ACORN_DATA_DIR || devDataDir())
// Asked once, before anything else prints (docs/node-distribution.md § Reaching a node from another
// machine); silent under a service manager (main/advertise.ts).
await confirmAdvertiseHost(root)
const capabilities = new CapabilityRegistry()
const runtime = makeRuntime(root, undefined, capabilities)
const disabledPlugins = disabledPluginsStore(root.dir)
// The disabled-plugin list a standalone node reads (docs/node-distribution.md § Plugins). There is
// no start-config override here: only the supervised host passes one.
const disabled = effectiveDisabled(disabledPlugins)
// Audit retention and the idempotency sweep run as node-owned schedules now, not boot-time calls
// (docs/data-layer.md § Retention).
setWorktreesRoot(join(root.dir, 'worktrees'))

// Same reporter as the supervised host, before the loader scans the install directory
// (docs/node-distribution.md § Plugins).
const bundledRoot = process.env.ACORN_BUNDLED_PLUGINS_DIR
const development = process.env.NODE_ENV !== 'production'
// Looks like a bug and is not one: `dev:node` with no bundled root reconciles nothing, so a
// `build:plugin` copy in the data root keeps running and a newer bundled package never arrives.
// That is the correct, permanent answer for a service-managed node; only a developer needs
// `ACORN_BUNDLED_PLUGINS_DIR` set.
if (development && !bundledRoot) {
  console.log('[plugins] ACORN_BUNDLED_PLUGINS_DIR is unset, so bundled packages are not reconciled — whatever is in the data root keeps running')
}
reconcileBundledPackages({ dataDir: root.dir, bundledRoot, development })

// The same deps the supervised composition root supplies (service/runtime.ts explains each one). A
// standalone node runs a real terminal engine, not a stub, because terminal is a required plugin
// (docs/plugins.md § Activation) and this node has to answer /v2/core/tasks/:id/archive for a task's
// live sessions.
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

// Every method rejects identically. There is no window on a standalone node, so nothing to drive,
// and a rejection beats a silent empty result: an agent that asked for a snapshot and got nothing
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

// Same plugin list, through the same builder, as the Electron-supervised root
// (docs/node-distribution.md § Runtime). They differ only where the runtime bridge does, here the
// preview browser.
const graph = await assembleNodeGraph(root.dir, buildPluginDeps({ capabilities, core, internalEnv, reconciled, browser: unavailableBrowser }))
// The node's one scheduler (docs/schedules.md § Why the node, and only the node).
const scheduler = createScheduler(runtime.DB, { env: runtime })
const schedulerCapability = capabilities.provide(SCHEDULER, scheduler)
const plugins = await initPlugins(graph.plugins, { capabilities, core, env: runtime, dataDir: root.dir, disabled: disabled(), loaded: graph.loaded })
const pluginStateCapability = capabilities.provide(
  PLUGIN_STATE,
  buildPluginStateBridge({
    dataDir: root.dir,
    roster: () => plugins.roster,
    booted: () => graph.installed.map((entry) => ({ id: entry.manifest.id, version: entry.manifest.version })),
    loadFailures: () => graph.failures,
    disabled,
    setDisabled: (names) => disabledPlugins.set(names),
    reloadHost: plugins,
  }),
)

// Core's own six agent tools and the config-trust bridge, matching service/runtime.ts. Both are pure
// functions over the database; neither needs a window.
wireAgentTools({ db: runtime.DB })

// Awaited, not fire-and-forget: there is nothing to hand back until the listener has bound, and a
// listen failure now exits non-zero with its reason instead of leaving a process alive that answers
// nothing.
const listener = await startListener(runtime, root)
apiUrl = listener.endpoint.origin
await scheduler.start()

// Re-attach sessions, repair worktree state, and sweep workflow/agent records through the shared
// post-listener sequence (server/composition.ts's reconcileNode; docs/node-distribution.md §
// Runtime). The listener is already live because resumed work calls the node's own authenticated
// routes.
const reconcileTask = reconcileNode({ db: runtime.DB, dataDir: root.dir, capabilities }).finally(() => finishReconcile())
await reconcileTask

// Counted before the handshake below, which issues a launcher device of its own when
// ACORN_DEVICE_TOKEN is unset. After that, every node looks paired.
const alreadyPaired = (await runtime.DEVICES.list()).filter((device) => device.revokedAt === null).length

// SIGINT and SIGTERM run the same bounded drain as an Electron-supervised node
// (docs/node-distribution.md § Operations).
let stopping = false
const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (stopping) return
  stopping = true
  console.log(`[node] ${signal} — draining`)
  const outcome = await drainNode({
    listener: () => closeListener(listener.server),
    reconciliation: async () => await reconcileTask,
    schedules: async () => {
      schedulerCapability.dispose()
      await scheduler.stop()
    },
    pluginState: async () => pluginStateCapability.dispose(),
    plugins: () => plugins.dispose(),
    sqlite: async () => runtime.DB.close(),
    dataRoot: async () => root.release(),
  })
  if (outcome === 'timeout') console.warn('[node] drain exceeded its deadline; exiting anyway')
  process.exit(0)
}

// Signals are wired before anything announces readiness, and the order matters: until
// `process.once('SIGTERM')` runs, SIGTERM keeps its default disposition, so the kernel kills the
// process outright, with no drain and no lock release. A supervisor, or the shutdown integration
// test, acts the instant it sees the handshake line, so anything printed before this point risks
// being killed mid-boot.
//
// SIGUSR1 reopens the pairing window (docs/node-distribution.md § Runtime): no token, no second
// port, and it needs shell access on this machine, the same "the owner is present" property pairing
// itself relies on.
process.on('SIGUSR1', () => printPairingBanner(runtime.PAIRING_CODES.issue()))
process.once('SIGINT', (signal) => void shutdown(signal))
process.once('SIGTERM', (signal) => void shutdown(signal))

console.log(
  JSON.stringify({
    nodeId: root.nodeId,
    // The handshake's protocol number (docs/api-reference.md § Versioning): a launcher can refuse a
    // node it cannot drive without pairing to it first.
    protocolVersion: NODE_PROTOCOL_VERSION,
    endpoint: listener.endpoint.origin,
    fingerprint: listener.fingerprint,
    certPem: listener.certPem,
    deviceToken: await resolveDeviceToken(runtime.DEVICES, process.env.ACORN_DEVICE_TOKEN, 'Standalone node launcher'),
  }),
)

// Prints the pairing banner the owner compares against the client's screen
// (docs/node-distribution.md § Runtime). Opens automatically only while nothing is paired yet, so a
// restart of a working node does not leave an unrequested window live.
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

