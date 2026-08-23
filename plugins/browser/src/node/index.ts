import type { NodePlugin, PluginFetchHandler } from '@acorn/plugin-api/node'
import { captureStore } from '../server/captures'
import { browserAgentTools } from '../server/agentTools'
import { BrowserPool } from '../server/driver'

// The browser plugin's node part: an agent's browser, driven by Playwright against an installed
// Chrome (docs/agent-tools.md § Browser tools).
//
// It replaces the six `browser_*` tools that used to live in `plugins/preview` and terminate in
// Electron main's `webContents.debugger`. That arrangement could only ever give a browser to an agent
// running beside a desktop window; this one gives it to any node, including a headless remote one,
// because the node owns agents and now owns their browser too.
//
// Compiled rather than loaded, and that is `playwright-core`'s doing rather than a preference. A
// loaded package is one inlined bundle with no node_modules of its own, and Playwright brings native
// bits with it — its own driver, and chokidar's optional `fsevents` — which is exactly the shape that
// cannot be inlined. Same reason `terminal` carries `node-pty` in this tier. So the roster line is in
// `apps/node/src/server/plugins.ts` and the dependency is the node's, beside the runtimes the shells
// already ship.
//
// Not `required`: a node with no browser loses six tools and nothing else. The tools stay registered
// either way and answer with the reason when there is nothing to launch, which is more useful to an
// agent than a tool that is silently absent.
export const browserPlugin = (): NodePlugin => {
  // Held here rather than at module scope, so re-registering this plugin builds a new pool instead of
  // sharing one with the instance the host has already disposed.
  const captures = { current: null as ReturnType<typeof captureStore> | null }
  let pool: BrowserPool | null = null

  // One route, and only a read: the bytes a screenshot produced, for whatever comes to look at them
  // later. Nothing writes through HTTP — a capture exists because a tool call made one.
  const serveCapture: PluginFetchHandler = async (request) => {
    const id = new URL(request.url, 'http://node').pathname.split('/').pop() ?? ''
    const capture = await captures.current?.read(id)
    if (!capture) return new Response(null, { status: 404 })
    return new Response(new Uint8Array(capture.bytes), {
      headers: {
        'content-type': capture.mime,
        // Fixed at capture time and the id is never reused, so it is immutable — but it is also one
        // owner's artefact, hence `private` rather than a shared cache lifetime.
        'cache-control': 'private, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      },
    })
  }

  return {
    name: 'browser',
    // This module's own URL; the host resolves the DDL chain from there, the same in a checkout, a
    // packaged app and a standalone tarball.
    migrationsModule: import.meta.url,
    init: (ctx) => {
      captures.current = captureStore(ctx.storage.open())
      pool = new BrowserPool(captures.current)
      for (const tool of browserAgentTools(pool)) ctx.tools.register(tool)
      ctx.routes.fetch(serveCapture, { prefix: '/captures', note: '/captures/:captureId' })
    },
    // A browser process outlives every request and has to be closed on the way down, or a node restart
    // leaves a headless Chrome behind holding its profile directory.
    dispose: async () => {
      await pool?.dispose()
      pool = null
    },
  }
}
