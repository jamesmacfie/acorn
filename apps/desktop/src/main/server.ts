import { serve, type Http2Bindings, type HttpBindings, type ServerType } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../server/index'
import { makeBindings, type RuntimeBindings } from './bindings'

const here = dirname(fileURLToPath(import.meta.url))
// Resolve packaged paths from this module, never process.cwd() — the app launches from Finder.
const clientDir = resolve(here, '../../dist/client')
// DEV data root: the repo-local apps/desktop/.acorn (gitignored). Only valid while running from a
// checkout — a packaged app's module dir is the read-only asar, so electron.ts passes an
// app.getPath('userData') root into startServer() instead when app.isPackaged.
export const devDataDir = resolve(here, '../../.acorn')
const indexHtml = readFileSync(resolve(clientDir, 'index.html'), 'utf8')

export const ACORN_PORT = Number(process.env.ACORN_PORT) || 4317

// Resolves with the live server and the runtime bindings — Electron passes runtime.DB to the
// terminal service so it shares this one SQLite connection (vNext §7) rather than opening a second.
// `dataDir` is the writable app-data root (DB, blobs, worktrees, notes): userData when packaged,
// the repo-local .acorn in dev / under plain Node.
export function startServer(dataDir: string = devDataDir): Promise<{ server: ServerType; runtime: RuntimeBindings }> {
  const runtime = makeBindings({
    dbPath: resolve(dataDir, 'acorn.sqlite'),
    blobsDir: resolve(dataDir, 'blobs'),
  })
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
  // loadURL the origin and read server.address() without a race.
  return new Promise((resolveServer) => {
    const server = serve({ fetch, hostname: '127.0.0.1', port: ACORN_PORT }, (info) => {
      console.log(`acorn server on http://127.0.0.1:${info.port}`)
      resolveServer({ server, runtime })
    })
  })
}

// Auto-start only under plain Node (the `dev:node` entry). Under Electron the main process calls
// startServer() explicitly, and this module is bundled in — so skip to avoid a double bind.
if (!process.versions.electron) void startServer()
