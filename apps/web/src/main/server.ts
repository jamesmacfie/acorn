import { serve, type Http2Bindings, type HttpBindings, type ServerType } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../server/index'
import { makeBindings } from './bindings'

const here = dirname(fileURLToPath(import.meta.url))
// Resolve packaged paths from this module, never process.cwd() — Phase 1 launches from Finder.
const clientDir = resolve(here, '../../dist/client')
const dataDir = resolve(here, '../../.acorn')
const indexHtml = readFileSync(resolve(clientDir, 'index.html'), 'utf8')

export const ACORN_PORT = Number(process.env.ACORN_PORT) || 4317

export function startServer(): Promise<ServerType> {
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
  // headers too so a DNS-rebinding page can't reach the local API as some other origin.
  const allowedHosts = new Set([`127.0.0.1:${ACORN_PORT}`, `localhost:${ACORN_PORT}`])
  const fetch = (request: Request, nodeEnv: HttpBindings | Http2Bindings) => {
    const host = request.headers.get('host')
    if (!host || !allowedHosts.has(host)) return new Response('Forbidden host', { status: 403 })
    return app.fetch(request, { ...nodeEnv, ...runtime } as unknown as Env)
  }

  // serve() binds asynchronously — resolve only once listening so callers (Electron) can safely
  // loadURL the origin and read server.address() without a race.
  return new Promise((resolveServer) => {
    const server = serve({ fetch, hostname: '127.0.0.1', port: ACORN_PORT }, (info) => {
      console.log(`acorn server on http://127.0.0.1:${info.port}`)
      resolveServer(server)
    })
  })
}

// Auto-start only under plain Node (the `dev:node` entry). Under Electron the main process calls
// startServer() explicitly, and this module is bundled in — so skip to avoid a double bind.
if (!process.versions.electron) void startServer()
