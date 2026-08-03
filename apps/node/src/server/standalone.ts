// The Electron-free entry: `pnpm dev:node` from a checkout, and the standalone node a client pairs
// with over the LAN (docs/vNext/plan.md § Phase 5, "standalone node distribution" — this is the down
// payment on it). It is a composition root: it registers the built-in integration providers, wires the
// pure-Node domain bridges, then starts the HTTPS listener over a data root. Under Electron this path
// is never taken — apps/desktop's main/bootstrap.ts owns boot and installs the stateful bridges too.
//
// Once listening it prints ONE line of JSON holding everything a client needs to reach it, pin it and
// authenticate to it. That handshake is not a convenience: the port is ephemeral now
// (main/serverConfig.ts), so a parent process — the two-node e2e today, a launchd/systemd wrapper
// later — cannot guess the endpoint, and the self-signed certificate has no CA to vouch for it.
// Everything else this process logs is free-form; this line is the contract.
import './providers' // register built-in integration providers into the core registry
import './routes' // register plugin-owned HTTP routers into the core route registry
import { devDataDir, makeRuntime, startListener } from '@acorn/node-core/main/server.ts'
import { openDataRoot } from '@acorn/node-core/main/dataRoot.ts'
import { resolveDeviceToken } from '@acorn/node-core/server/auth/deviceTokens.ts'
import { createCoreServices } from '@acorn/node-core/main/core/index.ts'
import { CapabilityRegistry } from '@acorn/node-core/server/plugin/capabilities.ts'
import { initPlugins } from '@acorn/node-core/server/plugin/host.ts'
import { nodePlugins } from './plugins'
import { wireServerBridges } from '../wiring/serverBridges'
import { prepareSecurityState } from '../wiring/startupSecurity'

// ACORN_DATA_DIR names the root explicitly. It is the same variable this node hands its own child
// processes (service/runtime.ts's internalApiEnv), so one spelling of "which root" covers the whole
// tree of processes. Unset means the repo-local dev root, which is what `dev:node` wants.
//
// Opening it takes the root's exclusive lock, so a standalone node and a running desktop app refuse to
// share one root explicitly instead of racing over SQLite.
const root = openDataRoot(process.env.ACORN_DATA_DIR || devDataDir())
const runtime = makeRuntime(root)
await prepareSecurityState(runtime)
await runtime.IDEMPOTENCY.cleanupExpired() // reclaim yesterday's replay rows; see service/runtime.ts
wireServerBridges(runtime.DB, root.dir) // the agent-usage HTTP route bridge (the rest are plugin-owned)
// Converted plugins register their own routes and open their own SQLite files here. A standalone node
// runs the SAME list as the supervised one — the difference is only which engine bridges get filled,
// so a plugin that needs no DesktopCapabilities works identically over the LAN.
// memory's launch injector queues its block into a PTY-backed agent session, and a standalone node has
// no terminal engine at all (that is the documented degraded mode), so the sender is a no-op here
// rather than a 503 the plugin would have to special-case.
await initPlugins(nodePlugins(root.dir, { memory: { sendToAgent: () => {}, currentUserId: () => runtime.ACTIVE_IDENTITY.get() } }), {
  capabilities: new CapabilityRegistry(),
  core: createCoreServices({ secrets: runtime.SECRETS, db: runtime.DB }),
})

// Awaited, not fire-and-forget: there is nothing to hand back until the listener has bound, and a
// listen failure now exits non-zero with its reason instead of leaving a process alive that answers
// nothing.
const listener = await startListener(runtime, root)

console.log(
  JSON.stringify({
    nodeId: root.nodeId,
    endpoint: listener.endpoint.origin,
    fingerprint: listener.fingerprint,
    certPem: listener.certPem,
    deviceToken: await resolveDeviceToken(runtime.DEVICES, process.env.ACORN_DEVICE_TOKEN, 'Standalone node launcher'),
  }),
)
