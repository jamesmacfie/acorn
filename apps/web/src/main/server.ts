import { serve, type Http2Bindings, type HttpBindings } from '@hono/node-server'
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

export function startServer() {
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

  const fetch = (request: Request, nodeEnv: HttpBindings | Http2Bindings) =>
    app.fetch(request, { ...nodeEnv, ...runtime } as unknown as Env, executionCtx)

  return serve({ fetch, hostname: '127.0.0.1', port: ACORN_PORT }, (info) =>
    console.log(`acorn server on http://127.0.0.1:${info.port}`),
  )
}

startServer()
