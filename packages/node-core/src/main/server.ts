import { createAdaptorServer, type Http2Bindings, type HttpBindings, type ServerType } from '@hono/node-server'
import type { ServiceEndpoint } from '@acorn/protocol/serviceProtocol.ts'
import { createServer as createHttpsServer } from 'node:https'
import { resolve } from 'node:path'
import { createApp } from '../server/index'
import { makeBindings, type RuntimeBindings } from './bindings'
import { openDataRoot, type DataRoot } from './dataRoot'
import { resolveDatabasePath } from './serverPaths'
import { configuredPort, devDataDir } from './serverConfig'
import { ensureCert } from './tls'
import { attachWsHub, type WsAuthDeps } from './wsHub'
import type { Env } from './bindings'

// DEV data root: the repo-local apps/desktop/.acorn (gitignored). Only valid while running from a
// checkout — a packaged app's module dir is the read-only asar, so electron.ts passes an
// app.getPath('userData') root into bootstrap() instead when app.isPackaged.
export { devDataDir }

// What the listener bound, plus the identity it bound it with. Returned rather than assumed by the
// caller: the parent used to compute the origin from a pinned port before the child existed, which
// cannot survive two nodes on one machine (docs/vNext/architecture.md § Topology). fingerprint/certPem
// sit BESIDE the endpoint rather than inside it, mirroring ServiceStartResult — the endpoint is where
// to connect, the pin is who answers.
export type Listener = { server: ServerType; endpoint: ServiceEndpoint; fingerprint: string; certPem: string }

// Start the loopback HTTPS listener over an already-built runtime. Split from startServer so the
// service composition root (app/service/runtime.ts) can wire the harness/context bridges into the route modules
// BEFORE the listener accepts requests (composition-root ownership boot-order fix). Resolves once listening so
// callers can safely reach the origin.
//
// It takes the DataRoot as well as the runtime because the transport identity lives on disk beside the
// database: the certificate is minted into <root>/tls, and the last bound port is remembered in
// node.json so a restart usually lands back on the same one.
export function startListener(runtime: RuntimeBindings, root: DataRoot): Promise<Listener> {
  // Every bridge (pure-Node domain bridges AND the stateful harness/context bridges) is installed by
  // the composition root (app/service/runtime.ts under Electron, app/server/devNode.ts under dev:node)
  // BEFORE this is called — core no longer imports plugin bridge wiring (docs/plugins.md).
  const app = createApp()

  // No static assets and no SPA fallback: "the Node serves no web assets" (docs/vNext/architecture.md).
  // The renderer ships with the desktop app and loads from app://acorn, so a node that answered with an
  // HTML shell would only be inviting a browser to treat it as an origin. Unmatched paths get Hono's
  // plain 404.

  const { keyPem, certPem, fingerprint } = ensureCert(root.dir)

  // Loopback Host guard (docs/electron.md §4g): we bind 127.0.0.1, but reject unexpected Host
  // headers too so a DNS-rebinding page can't reach the local API as some other origin. Only the
  // 127.0.0.1 form is allowed — the endpoint we report, and every doc, standardise on it.
  //
  // Assigned in the listening callback, not at build time: the port is ephemeral now, so there is no
  // expected Host until the kernel has picked one. Empty means "not listening yet" and rejects
  // everything, which is the safe direction for the sliver of time before the callback runs.
  let allowedHost = ''
  const fetch = (request: Request, nodeEnv: HttpBindings | Http2Bindings) => {
    const host = request.headers.get('host')
    if (!allowedHost || host !== allowedHost) return new Response('Forbidden host', { status: 403 })
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
    // TLS 1.3 only (docs/vNext/security.md § Transport and authentication). Every client is one we
    // ship — the broker's https.Agent, `ws`, and Node children — so there is no legacy peer to
    // accommodate, and pinning the floor here means the transport cannot be downgraded.
    serverOptions: { key: keyPem, cert: certPem, minVersion: 'TLSv1.3' },
    hostname: '127.0.0.1',
  })

  // The one authenticated WebSocket (/v2/events) shares this listener via its 'upgrade' event; the hub
  // re-checks Host plus a device bearer or the internal token before the handshake, and holds the device
  // service so a revoked device's sockets close immediately. https.Server extends http.Server, so the
  // hub's node:http typing still describes it exactly.
  //
  // `allowedHost` is read at upgrade time by the hub's authorize(), so it is filled in once the port is
  // known — the same "mutable on purpose, read per call" shape service/runtime.ts uses for
  // internalApiEnv.
  const wsDeps: WsAuthDeps = {
    internalToken: runtime.INTERNAL_TOKEN,
    allowedHost: '',
    devices: runtime.DEVICES,
  }
  attachWsHub(server as unknown as import('node:http').Server, wsDeps)

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
        server.listen(0, '127.0.0.1', onListening)
        return
      }
      reject(error)
    }
    function onListening(): void {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('acorn server bound no TCP port'))
      allowedHost = `127.0.0.1:${address.port}`
      wsDeps.allowedHost = allowedHost
      root.recordPort(address.port)
      console.log(`acorn server on https://${allowedHost}`)
      server.off('error', onError) // listening — later runtime errors are not listen failures
      resolveServer({ server, endpoint: { origin: `https://${allowedHost}`, port: address.port }, fingerprint, certPem })
    }
    server.on('error', onError)
    server.listen(requested, '127.0.0.1', onListening)
  })
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
export function makeRuntime(root: DataRoot, appVersion = '0.0.0-dev'): RuntimeBindings {
  return makeBindings({
    dbPath: resolveDatabasePath(root.dir),
    blobsDir: resolve(root.dir, 'blobs'),
    nodeId: root.nodeId,
    appVersion,
  })
}

// Open the data root, build the runtime AND start listening in one call — the plain-Node `dev:node`
// entry (app/server/devNode.ts) has no composition root, so it needs all three. Kept in core (pure
// engine); the dev:node entry lives in app/ because choosing to auto-start + registering plugin
// providers is composition, not engine.
export function startServer(dataDir: string = devDataDir()): Promise<Listener> {
  const root = openDataRoot(dataDir)
  return startListener(makeRuntime(root), root)
}
