import { serve, type Http2Bindings, type HttpBindings, type ServerType } from '@hono/node-server'
import type { ServiceEndpoint } from '@acorn/protocol/serviceProtocol.ts'
import { serveStatic } from '@hono/node-server/serve-static'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createApp } from '../server/index'
import { makeBindings, type RuntimeBindings } from './bindings'
import { openDataRoot, type DataRoot } from './dataRoot'
import { resolveDatabasePath } from './serverPaths'
import { ACORN_PORT, devClientDir, devDataDir } from './serverConfig'
import { attachWsHub } from './wsHub'
import type { Env } from './bindings'

// DEV data root: the repo-local apps/desktop/.acorn (gitignored). Only valid while running from a
// checkout — a packaged app's module dir is the read-only asar, so electron.ts passes an
// app.getPath('userData') root into bootstrap() instead when app.isPackaged.
export { devDataDir }

export { ACORN_PORT }

export type StartListenerOptions = { clientDir?: string }

// What the listener bound. Returned rather than assumed by the caller: the parent used to compute
// the origin from a pinned port before the child existed, which cannot survive two nodes on one
// machine (docs/vNext/architecture.md § Topology).
export type Listener = { server: ServerType; endpoint: ServiceEndpoint }

// Start the loopback HTTP listener over an already-built runtime. Split from startServer so the
// service composition root (app/service/runtime.ts) can wire the harness/context bridges into the route modules
// BEFORE the listener accepts requests (composition-root ownership boot-order fix). Resolves once listening so
// callers can safely loadURL the origin.
export function startListener(runtime: RuntimeBindings, options: StartListenerOptions = {}): Promise<Listener> {
  // Every bridge (pure-Node domain bridges AND the stateful harness/context bridges) is installed by
  // the composition root (app/service/runtime.ts under Electron, app/server/devNode.ts under dev:node)
  // BEFORE this is called — core no longer imports plugin bridge wiring (docs/plugins.md).
  const app = createApp()

  // Where the built renderer lives. Injected by the composition root so this module holds no
  // opinion about the package layout around it; defaults to the dev checkout for `dev:node`.
  const clientDir = options.clientDir ?? devClientDir()
  const indexHtml = readFileSync(resolve(clientDir, 'index.html'), 'utf8')

  // Serve the built SPA, and fall back to the shell only for non-API/auth navigations — so
  // unmatched /v2/* and /auth/* still return JSON/text 404s rather than the HTML shell.
  app.use('/*', serveStatic({ root: clientDir }))
  app.notFound((c) => {
    const path = new URL(c.req.url).pathname
    if (path.startsWith('/v2/') || path.startsWith('/auth/')) return c.text('Not found', 404)
    return c.html(indexHtml)
  })

  // Loopback Host guard (docs/electron.md §4g): we bind 127.0.0.1, but reject unexpected Host
  // headers too so a DNS-rebinding page can't reach the local API as some other origin. Only the
  // 127.0.0.1 form is allowed — the OAuth app, window origin, and docs all standardise on it.
  const allowedHost = `127.0.0.1:${ACORN_PORT}`
  const fetch = (request: Request, nodeEnv: HttpBindings | Http2Bindings) => {
    const host = request.headers.get('host')
    if (!host || host !== allowedHost) return new Response('Forbidden host', { status: 403 })
    // serve() below creates a plain node:http server, so nodeEnv is always HttpBindings — narrow
    // it once here. Env is RuntimeBindings & Partial<HttpBindings> (./bindings), so the merged
    // object IS the env the routes see — no `as unknown as Env` double cast at this seam.
    const env: Env = { ...(nodeEnv as HttpBindings), ...runtime }
    return app.fetch(request, env)
  }

  // serve() binds asynchronously — resolve only once listening so callers (Electron) can safely
  // loadURL the origin and read server.address() without a race. Reject on listen failure
  // (EADDRINUSE on the pinned port — e.g. a dev:node process still running) so bootstrap can
  // surface it instead of the raw 'error' event crashing the process before any window exists.
  return new Promise((resolveServer, reject) => {
    const server = serve({ fetch, hostname: '127.0.0.1', port: ACORN_PORT }, (info) => {
      console.log(`acorn server on http://127.0.0.1:${info.port}`)
      server.off('error', reject) // listening — later runtime errors are not listen failures
      resolveServer({ server, endpoint: { origin: `http://127.0.0.1:${info.port}`, port: info.port } })
    })
    // The one authenticated WebSocket (the WebSocket transport) shares this loopback listener via its
    // 'upgrade' event; the hub re-checks Host + Origin + session cookie before the handshake.
    attachWsHub(server as unknown as import('node:http').Server, {
      encKey: runtime.SESSION_ENC_KEY,
      internalToken: runtime.INTERNAL_TOKEN,
      allowedHost,
      origin: `http://${allowedHost}`,
    })
    server.once('error', reject)
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
  return startListener(makeRuntime(openDataRoot(dataDir)))
}
