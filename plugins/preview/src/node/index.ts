// Node-owned preview home URL resolution. The shell owns the native webview;
// this plugin exposes capabilities, routes, and invalidation events through the plugin API.
import type { NodePlugin, PluginFetchHandler } from '@acorn/plugin-api/node'
import { TERMINAL_RUN_TARGETS } from '@acorn/plugin-terminal/contract/runTargets.ts'
import { PREVIEW_URLS } from '../contract/urls'
import { loopbackPort } from '../server/loopbackPort'
import { createPreviewUrlRuntime, type PreviewUrlRuntime } from '../server/previewUrls'

export const previewPlugin = (): NodePlugin => {
  let urls: PreviewUrlRuntime | null = null

  return {
    name: 'preview',
    label: 'Preview',
    emits: [{ verb: 'url-changed', description: 'A task’s resolved preview home URL changed' }],
    init: (ctx) => {
      urls = createPreviewUrlRuntime(ctx.core, () => ctx.capabilities.get(TERMINAL_RUN_TARGETS), ctx.events.send)
      ctx.capabilities.provide(PREVIEW_URLS, { forTask: (taskId) => urls!.forTask(taskId) })

      const serveUrl: PluginFetchHandler = async (request, context) => {
        const path = new URL(request.url, 'http://node').pathname
        // Every active task on the node, so a task-scoped caller has no business reading it.
        if (path === '/configured' && request.method === 'GET') {
          if (context.principal.scope === 'task') return Response.json({ error: 'forbidden' }, { status: 403 })
          return Response.json(await urls!.configured())
        }
        const match = /^\/tasks\/([^/]+)\/(url|recipe-url)$/.exec(path)
        if (!match) return new Response(null, { status: 404 })
        const taskId = decodeURIComponent(match[1]!)
        if (context.principal.scope === 'task' && context.principal.taskId !== taskId) {
          return Response.json({ error: 'forbidden' }, { status: 403 })
        }
        if (match[2] === 'url' && request.method === 'GET') {
          return Response.json(await urls!.forTask(taskId))
        }
        if (match[2] === 'recipe-url' && request.method === 'POST') {
          const body = (await request.json().catch(() => null)) as { url?: unknown } | null
          if (typeof body?.url !== 'string' || !body.url.trim()) {
            return Response.json({ error: 'bad_request' }, { status: 400 })
          }
          await urls!.selectRecipe(taskId, body.url)
          return Response.json({ ok: true })
        }
        return new Response(null, { status: 405 })
      }
      ctx.routes.fetch(serveUrl, {
        prefix: '',
        note: '/tasks/:taskId/url — resolved preview home; /configured — which tasks have one',
      })

      // The task's app, through this Node to a paired device, and to a phone's browser on a name of its own
      // (docs/relay/phone-channel.md § Previews). Core decides who may use it and what the page may do.
      ctx.routes.loopback({
        prefix: '/tasks/:taskId/proxy',
        note: "/tasks/:taskId/proxy/* — the task's app on this Node's loopback; /tasks/:taskId/proxy/__acorn/open — an address a phone's browser can load",
        target: async ({ taskId }) => loopbackPort((await urls!.forTask(taskId!))?.url),
      })

      ctx.events.on('run:changed', (event) => {
        if (typeof event.taskId !== 'string') return
        void urls
          ?.refresh(event.taskId)
          .catch((error: unknown) =>
            ctx.log.warn(`preview URL refresh failed: ${error instanceof Error ? error.message : String(error)}`),
          )
      })
      ctx.events.on('tasks:changed', (event) => {
        void urls
          ?.refreshTasks(typeof event.taskId === 'string' ? event.taskId : null)
          .catch((error: unknown) =>
            ctx.log.warn(`preview URL refresh failed: ${error instanceof Error ? error.message : String(error)}`),
          )
      })
      ctx.events.on('project:changed', (event) => {
        if (typeof event.projectId !== 'string') return
        void urls
          ?.refreshProject(event.projectId)
          .catch((error: unknown) =>
            ctx.log.warn(`preview URL refresh failed: ${error instanceof Error ? error.message : String(error)}`),
          )
      })
    },
    dispose: () => {
      urls?.dispose()
      urls = null
    },
  }
}
