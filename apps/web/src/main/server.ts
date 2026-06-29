import { serve, type Http2Bindings, type HttpBindings, type ServerType } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExecutionContext } from 'hono'
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

  // Replaces wrangler.jsonc's declarative `assets` block: serve built SPA, fall back to the
  // shell only for non-API/auth navigations (preserving run_worker_first 404 semantics).
  app.use('/*', serveStatic({ root: clientDir }))
  app.notFound((c) => {
    const path = new URL(c.req.url).pathname
    if (path.startsWith('/api/') || path.startsWith('/auth/')) return c.text('Not found', 404)
    return c.html(indexHtml)
  })

  // node-server provides no ExecutionContext, but routes read c.executionCtx (Hono's getter
  // throws if unset) to pass to waitUntilLogged. A no-op stub satisfies it; the background
  // promise self-runs in the long-lived Node process.
  const executionCtx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext

  // Loopback Host guard (docs/electron.md §4g): we bind 127.0.0.1, but reject unexpected Host
  // headers too so a DNS-rebinding page can't reach the local API as some other origin.
  const allowedHosts = new Set([`127.0.0.1:${ACORN_PORT}`, `localhost:${ACORN_PORT}`])
  const fetch = (request: Request, nodeEnv: HttpBindings | Http2Bindings) => {
    const host = request.headers.get('host')
    if (!host || !allowedHosts.has(host)) return new Response('Forbidden host', { status: 403 })
    return app.fetch(request, { ...nodeEnv, ...runtime } as unknown as Env, executionCtx)
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
