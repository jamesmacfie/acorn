import { createAdaptorServer, type Http2Bindings, type HttpBindings, type ServerType } from '@hono/node-server'
import type { ServiceEndpoint } from '@acorn/protocol/serviceProtocol.ts'
import { createServer as createHttpsServer } from 'node:https'
import { resolve } from 'node:path'
import { createApp } from '../server/index'
import { makeBindings, type RuntimeBindings } from './bindings'
import { CapabilityRegistry } from '../server/plugin/capabilities'
import { openDataRoot, type DataRoot } from './dataRoot'
import { resolveDatabasePath } from './serverPaths'
import { configuredPort, devDataDir } from './serverConfig'
import { advertisedHosts } from './advertise'
import { ensureCert } from './tls'
import { attachWsHub, disposeWsHub } from './wsHub'
import { attachTunnel, disposeTunnel, type TunnelDeps } from './tunnel'
import { isUpgradeClaimed } from './upgradeClaim'
import { declaredTunnelPorts } from './tunnelPorts'
import type { Env } from './bindings'

// DEV data root: the repo-local apps/node/.acorn (gitignored) — it belongs to apps/node because the
// node owns SQLite, blobs and the node identity (./serverPaths.ts). Only valid while running from a
// checkout — a packaged app's module dir is the read-only asar, so electron.ts passes an
// app.getPath('userData') root into bootstrap() instead when app.isPackaged.
export { devDataDir }

// What the listener bound, plus the certificate identity it bound it with. The endpoint is reported
// after the kernel chooses a port; the fingerprint and certificate let the broker pin that endpoint.
export type Listener = { server: ServerType; endpoint: ServiceEndpoint; fingerprint: string; certPem: string }

// Start the loopback HTTPS listener over an already-built runtime. The service composition root wires the
// harness and context bridges before the listener accepts requests. Resolves once listening so callers
// can safely reach the origin.
//
// It takes the DataRoot as well as the runtime because the transport identity lives on disk beside the
// database: the certificate is minted into <root>/tls, and the last bound port is remembered in
// node.json so a restart usually lands back on the same one.
export function startListener(runtime: RuntimeBindings, root: DataRoot): Promise<Listener> {
  // Every bridge (pure-Node domain bridges AND the stateful harness/context bridges) is installed by
  // the composition root (apps/node's service/runtime.ts under Electron, server/standalone.ts
  // otherwise) BEFORE this is called — core no longer imports plugin bridge wiring (docs/plugins.md).
  const app = createApp()

  // No static assets and no SPA fallback: the Node serves API and event traffic only.
  // The renderer ships with the desktop app and loads from app://acorn, so a node that answered with an
  // HTML shell would only be inviting a browser to treat it as an origin. Unmatched paths get Hono's
  // plain 404.

  const { keyPem, certPem, fingerprint } = ensureCert(root.dir)

  // Host guard (docs/electron.md §4g): binding an interface is not the same as answering to any name
  // on it, so a Host we did not expect is refused — that is what stops a DNS-rebinding page from
  // reaching this API as some other origin. Loopback is always allowed; anything else is here because
  // the operator advertised it (main/advertise.ts).
  //
  // ONE Set, shared by reference with the two upgrade handlers below and filled in place once the
  // kernel has picked a port. It starts empty and therefore rejects everything, which is the safe
  // direction for the sliver of time before the listening callback runs. Nobody may copy it: the
  // tunnel was first attached with a spread of its deps, which snapshotted the old string field while
  // it was still empty, and its Host guard then rejected every upgrade forever — a bare 403 with
  // nothing logged, caught only by the two-node e2e.
  const allowedHosts = new Set<string>()
  const advertised = advertisedHosts(root)
  // 0.0.0.0 rather than the advertised address itself: children of this node still reach it over
  // loopback with full certificate validation (the cert's SAN is IP:127.0.0.1), so both audiences
  // have to keep working. `endpoint` below stays loopback for the same reason.
  const bindHost = advertised.length > 0 ? '0.0.0.0' : '127.0.0.1'
  const fetch = (request: Request, nodeEnv: HttpBindings | Http2Bindings) => {
    const host = request.headers.get('host')
    if (!host || !allowedHosts.has(host)) return new Response('Forbidden host', { status: 403 })
    // serve() below creates a node:https server, whose bindings are still HttpBindings (https.Server
    // extends http.Server) — narrow it once here. Env is RuntimeBindings & Partial<HttpBindings>
    // (./bindings), so the merged object IS the env the routes see — no `as unknown as Env` double
    // cast at this seam.
    const env: Env = { ...(nodeEnv as HttpBindings), ...runtime }
    return app.fetch(request, env)
  }

  // An explicit ACORN_PORT is a demand (dev:node, tests) and never falls back. Otherwise prefer the
  // port this root last bound, so a restart usually keeps the same endpoint, and fall back to
  // ephemeral when something else has taken it.
  const requested = configuredPort() ?? root.preferredPort ?? 0
  const mayFallBack = configuredPort() === undefined && requested !== 0

  // createAdaptorServer + an explicit listen() rather than serve(): a retry after EADDRINUSE has to
  // re-listen the SAME server object, or the hub below would be attached to a discarded one.
  const server = createAdaptorServer({
    fetch,
    createServer: createHttpsServer,
    // TLS 1.3 only (docs/security.md § Transport and authentication). Every client is one we
    // ship — the broker's https.Agent, `ws`, and Node children — so there is no legacy peer to
    // accommodate, and pinning the floor here means the transport cannot be downgraded.
    serverOptions: { key: keyPem, cert: certPem, minVersion: 'TLSv1.3' },
    hostname: bindHost,
  })

  // The one authenticated WebSocket (/v2/events) shares this listener via its 'upgrade' event; the hub
  // re-checks Host plus a device bearer or the internal token before the handshake, and holds the device
  // service so a revoked device's sockets close immediately. https.Server extends http.Server, so the
  // hub's node:http typing still describes it exactly.
  //
  // The same `allowedHosts` Set the fetch guard above reads, by reference — see the note there for
  // why it must not be copied.
  const upgradeDeps: TunnelDeps = {
    internalToken: runtime.INTERNAL_TOKEN,
    allowedHosts,
    devices: runtime.DEVICES,
    // Derived from what this node already resolves for the task, so the tunnel's allowlist is not a new
    // configuration surface (main/tunnelPorts.ts).
    declaredPorts: declaredTunnelPorts(runtime.DB, runtime.CAPABILITIES),
  }
  attachWsHub(server as unknown as import('node:http').Server, upgradeDeps)

  // The preview tunnel (/v2/tunnel) shares the same listener and the same upgrade auth, so a remote task's
  // dev server is reachable from the client without the node exposing anything beyond loopback
  // (main/tunnel.ts explains why this is a dedicated upgrade rather than a multiplexed stream frame).
  attachTunnel(server as unknown as import('node:http').Server, upgradeDeps)

  // Registered LAST, so it runs after both handlers above have had their synchronous chance to claim. An
  // upgrade neither of them owns is destroyed here rather than left open forever — see
  // main/upgradeClaim.ts for what Node does (and stops doing) once any 'upgrade' listener exists.
  ;(server as unknown as import('node:http').Server).on('upgrade', (_req, socket) => {
    if (!isUpgradeClaimed(socket)) socket.destroy()
  })

  // Binding is asynchronous — resolve only once listening so callers can safely reach the origin
  // without a race. Reject on listen failure so bootstrap can surface it instead of the raw 'error'
  // event crashing the process before any window exists.
  return new Promise((resolveServer, reject) => {
    // Exactly once. Retrying port 0 on an EADDRINUSE would be an unbounded warn-and-relisten loop
    // (ephemeral exhaustion is the only way to get there, and it does not clear by retrying) — a
    // spinning process is a worse failure than a rejected start.
    let retried = false
    const onError = (error: NodeJS.ErrnoException): void => {
      if (mayFallBack && !retried && error.code === 'EADDRINUSE') {
        // The remembered port belongs to someone else now. An ephemeral port is still a correct
        // endpoint — the client is told where we bound rather than assuming — so this is a retry.
        retried = true
        console.warn(`[server] port ${requested} is taken; binding an ephemeral port instead`)
        server.listen(0, bindHost, onListening)
        return
      }
      reject(error)
    }
    function onListening(): void {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('acorn server bound no TCP port'))
      // Filled in place, never reassigned: the upgrade handlers hold this same Set.
      allowedHosts.add(`127.0.0.1:${address.port}`)
      for (const host of advertised) allowedHosts.add(`${host}:${address.port}`)
      root.recordPort(address.port)
      console.log(`acorn server on https://127.0.0.1:${address.port}`)
      for (const host of advertised) console.log(`acorn server also answering to https://${host}:${address.port}`)
      server.off('error', onError) // listening — later runtime errors are not listen failures
      // Loopback, even when advertising: this origin is handed to child processes, which validate the
      // certificate fully against its IP:127.0.0.1 SAN. The address a remote client uses is the one the
      // operator was shown, not this.
      resolveServer({ server, endpoint: { origin: `https://127.0.0.1:${address.port}`, port: address.port }, fingerprint, certPem })
    }
    server.on('error', onError)
    server.listen(requested, bindHost, onListening)
  })
}

// Stop accepting, then reap every socket this listener still owns. Both composition roots call it as
// the FIRST teardown step, and it lives here rather than in either of them because it is the only
// place that knows what `startListener` attached: two upgrade handlers with their own socket sets,
// neither of which `server.close()` can see.
//
// Both composition roots call this shared helper so the listener and its upgraded connections stop
// before plugin and database teardown begins.
export function closeListener(server: ServerType | null): Promise<void> {
  if (!server) return Promise.resolve()
  const httpServer = server as unknown as import('node:http').Server
  disposeWsHub(httpServer)
  // Tunnel sockets hold a live TCP connection to a dev server on this host, so they have to be terminated
  // too — `closeAllConnections` below reaps the HTTP sockets but an upgraded one is the tunnel's, not the
  // server's, to close.
  disposeTunnel(httpServer)
  return new Promise((resolve) => {
    server.close(() => resolve())
    // Node otherwise waits out keepAliveTimeout for an idle renderer/fetch socket. Once close()
    // has stopped new requests, loopback connections are safe to reap immediately; WebSockets were
    // already terminated by disposeWsHub above.
    httpServer.closeIdleConnections?.()
    httpServer.closeAllConnections?.()
  })
}

// Shutdown drains in-flight work with a bounded timeout. The process exits even if one plugin's dispose
// never settles.
export const DRAIN_TIMEOUT_MS = 30_000

// Run a drain to completion or to the deadline, whichever comes first, reporting which. The steps are
// awaited in order (each one's teardown assumes the previous one finished — plugins before core's
// SQLite before the root lock), so the deadline covers the SEQUENCE rather than each step: a step that
// hangs must not get its own fresh 30 seconds after two others already spent theirs.
export async function drainWithDeadline(
  steps: readonly (readonly [string, () => Promise<unknown>])[],
  timeoutMs = DRAIN_TIMEOUT_MS,
): Promise<'drained' | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
    timer.unref?.()
  })
  const run = (async (): Promise<'drained'> => {
    for (const [label, step] of steps) {
      try {
        await step()
      } catch (error) {
        // A failed step is not a reason to skip the rest: the root lock still has to come off.
        console.warn(`[node] ${label} teardown failed:`, error)
      }
    }
    return 'drained'
  })()
  try {
    return await Promise.race([run, expired])
  } finally {
    clearTimeout(timer)
  }
}

// One definition of the on-disk app-data layout under a data root (DB, blobs) — Electron's utility
// service and the plain-Node `dev:node` entry both build their runtime through it.
//
// It takes an already-opened DataRoot rather than a path because the root carries the nodeId AND the
// exclusive lock. The lock's lifetime is the process's, so acquiring it belongs to whoever owns
// teardown (the composition root), not to a bindings factory that has no stop() to hook.
// `appVersion` comes from the composition root (Electron's app.getVersion(), via ServiceStartConfig).
// The plain-Node entry has no packaged version, and saying so is more useful than parsing a
// package.json that will not exist beside the bundled artifact.
export function makeRuntime(root: DataRoot, appVersion = '0.0.0-dev', capabilities = new CapabilityRegistry()): RuntimeBindings {
  return makeBindings({
    dbPath: resolveDatabasePath(root.dir),
    blobsDir: resolve(root.dir, 'blobs'),
    nodeId: root.nodeId,
    appVersion,
    capabilities,
  })
}

// Open the data root, build the runtime AND start listening in one call. Kept in core (pure engine);
// the standalone entry lives in apps/node (server/standalone.ts) because choosing to auto-start and
// registering plugin providers is composition, not engine.
export function startServer(dataDir: string = devDataDir()): Promise<Listener> {
  const root = openDataRoot(dataDir)
  return startListener(makeRuntime(root), root)
}
