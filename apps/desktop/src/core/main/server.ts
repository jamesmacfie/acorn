import { serve, type Http2Bindings, type HttpBindings, type ServerType } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../server/index'
import { makeBindings, type RuntimeBindings } from './bindings'
import { resolveServerPaths } from './serverPaths'
import { attachWsHub } from './wsHub'

const here = dirname(fileURLToPath(import.meta.url))
// Resolve from the desktop package root, never process.cwd() or a fixed module depth: source-mode
// dev:node runs this file under src/core/main while electron-vite bundles it under out/main.
const serverPaths = resolveServerPaths(here)
const clientDir = serverPaths.clientDir
// DEV data root: the repo-local apps/desktop/.acorn (gitignored). Only valid while running from a
// checkout — a packaged app's module dir is the read-only asar, so electron.ts passes an
// app.getPath('userData') root into bootstrap() instead when app.isPackaged.
export const devDataDir = serverPaths.devDataDir
const indexHtml = readFileSync(resolve(clientDir, 'index.html'), 'utf8')

export const ACORN_PORT = Number(process.env.ACORN_PORT) || 4317

// Start the loopback HTTP listener over an already-built runtime. Split from startServer so the
// composition root (main/bootstrap.ts) can wire the harness/context bridges into the route modules
// BEFORE the listener accepts requests (review §2 boot-order fix). Resolves once listening so
// callers can safely loadURL the origin.
export function startListener(runtime: RuntimeBindings): Promise<ServerType> {
  // Every bridge (pure-Node domain bridges AND the stateful harness/context bridges) is installed by
  // the composition root (app/main/bootstrap.ts under Electron, app/server/devNode.ts under dev:node)
  // BEFORE this is called — core no longer imports plugin bridge wiring (docs/next Phase 10).
  const app = createApp()

  // Serve the built SPA, and fall back to the shell only for non-API/auth navigations — so
  // unmatched /api/* and /auth/* still return JSON/text 404s rather than the HTML shell.
  app.use('/*', serveStatic({ root: clientDir }))
  app.notFound((c) => {
    const path = new URL(c.req.url).pathname
    if (path.startsWith('/api/') || path.startsWith('/auth/')) return c.text('Not found', 404)
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
    // it once here. Env extends RuntimeBindings + Partial<HttpBindings> (env.d.ts), so the merged
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
      resolveServer(server)
    })
    // The one authenticated WebSocket (Phase 3 slice 6) shares this loopback listener via its
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

// One definition of the on-disk app-data layout under `dataDir` (DB, blobs) — Electron's
// composition root and the plain-Node `dev:node` entry both build their runtime through it.
export function makeRuntime(dataDir: string): RuntimeBindings {
  return makeBindings({
    dbPath: resolve(dataDir, 'acorn.sqlite'),
    blobsDir: resolve(dataDir, 'blobs'),
  })
}

// Build the runtime bindings AND start listening in one call — the plain-Node `dev:node` entry
// (app/server/devNode.ts) has no composition root, so it needs both. Kept in core (pure engine);
// the dev:node entry lives in app/ because choosing to auto-start + registering plugin providers
// is composition, not engine.
export function startServer(dataDir: string = devDataDir): Promise<ServerType> {
  return startListener(makeRuntime(dataDir))
}
