import type { NodePlugin, PluginFetchHandler } from '@acorn/plugin-api/node'
import { captureStore } from '../server/captures'
import { browserAgentTools } from '../server/agentTools'
import { BrowserPool } from '../server/driver'

// The browser plugin's node part: an agent's browser, driven by Playwright against an installed
// Chrome. See docs/agent-tools.md § Browser tools.
//
// Compiled rather than loaded, because of `playwright-core`. A loaded package is one inlined bundle
// with no node_modules of its own, and Playwright brings native bits with it: its own driver, and
// chokidar's optional `fsevents`. Same reason `terminal` carries `node-pty` in this tier.
//
// Not `required`: a node with no browser loses six tools and nothing else. The tools stay registered
// and answer with the reason when there is nothing to launch, which tells an agent more than a tool
// that is silently absent.
export const browserPlugin = (): NodePlugin => {
  // Held here rather than at module scope, so re-registering this plugin builds a new pool instead of
  // sharing one the host has already disposed.
  const captures = { current: null as ReturnType<typeof captureStore> | null }
  let pool: BrowserPool | null = null

  // One route, read only: the bytes a screenshot produced. Nothing writes through HTTP, because a
  // capture exists only because a tool call made one.
  const serveCapture: PluginFetchHandler = async (request) => {
    const id = new URL(request.url, 'http://node').pathname.split('/').pop() ?? ''
    const capture = await captures.current?.read(id)
    if (!capture) return new Response(null, { status: 404 })
    return new Response(new Uint8Array(capture.bytes), {
      headers: {
        'content-type': capture.mime,
        // Fixed at capture time and the id is never reused, so it is immutable. `private` because it
        // is one owner's artefact.
        'cache-control': 'private, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      },
    })
  }

  return {
    name: 'browser',
    // This module's own URL. The host resolves the DDL chain from there, the same in a checkout, a
    // packaged app, and a standalone tarball.
    migrationsModule: import.meta.url,
    init: (ctx) => {
      captures.current = captureStore(ctx.storage.open())
      pool = new BrowserPool(captures.current)
      for (const tool of browserAgentTools(pool)) ctx.tools.register(tool)
      ctx.routes.fetch(serveCapture, { prefix: '/captures', note: '/captures/:captureId' })
    },
    // A browser process outlives every request. Close it on the way down, or a node restart leaves a
    // headless Chrome behind holding its profile directory.
    dispose: async () => {
      await pool?.dispose()
      pool = null
    },
  }
}
