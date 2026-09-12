// The preview plugin's node part (docs/plugins.md § The plugin API).
//
// This is the smallest NodePlugin in the tree because preview is mostly a shell feature: the pane is
// a host-owned webview the desktop shell positions over the client (docs/shell.md § Host-owned
// webviews). Its only node-side surface is one capability: reading a task's browser_rules.
//
// That read needs core's tasks and projects tables, so it takes CoreServices rather than the
// database handle the composition root used to pass to a loose previewRulesForTask function in
// service/runtime.ts. It briefly owned the six browser_* agent tools too; those left for
// `plugins/browser`, whose driver is Playwright on the node rather than CDP in a desktop shell
// (docs/agent-tools.md § Browser tools).
//
// No database, no routes, no dispose: there is nothing to release. It is not `required`: a node with
// preview disabled reports no page rules, which the pane already treats as an empty rule set.
import type { NodePlugin, PluginFetchHandler } from '@acorn/plugin-api/node'
import { TERMINAL_RUN_TARGETS } from '@acorn/plugin-terminal/contract/runTargets.ts'
import { PREVIEW_RULES } from '../contract/rules'
import { PREVIEW_URLS } from '../contract/urls'
import { previewRulesForTask } from '../server/previewRules'
import { createPreviewUrlRuntime, type PreviewUrlRuntime } from '../server/previewUrls'

export const previewPlugin = (): NodePlugin => {
  let urls: PreviewUrlRuntime | null = null

  return {
    name: 'preview',
    emits: [
      { verb: 'url-changed', description: 'A task’s resolved preview home URL changed' },
    ],
    init: (ctx) => {
      urls = createPreviewUrlRuntime(ctx.core, () => ctx.capabilities.get(TERMINAL_RUN_TARGETS), ctx.events.send)
      ctx.capabilities.provide(PREVIEW_RULES, { forTask: (taskId) => previewRulesForTask(ctx.core, taskId) })
      ctx.capabilities.provide(PREVIEW_URLS, { forTask: (taskId) => urls!.forTask(taskId) })

      const serveUrl: PluginFetchHandler = async (request, context) => {
        const path = new URL(request.url, 'http://node').pathname
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
          const body = await request.json().catch(() => null) as { url?: unknown } | null
          if (typeof body?.url !== 'string' || !body.url.trim()) {
            return Response.json({ error: 'bad_request' }, { status: 400 })
          }
          await urls!.selectRecipe(taskId, body.url)
          return Response.json({ ok: true })
        }
        return new Response(null, { status: 405 })
      }
      ctx.routes.fetch(serveUrl, { prefix: '', note: '/tasks/:taskId/url — resolved preview home' })

      ctx.events.on('run:changed', (event) => {
        if (typeof event.taskId !== 'string') return
        void urls?.refresh(event.taskId).catch((error: unknown) => ctx.log.warn(`preview URL refresh failed: ${error instanceof Error ? error.message : String(error)}`))
      })
      ctx.events.on('project:changed', (event) => {
        if (typeof event.projectId !== 'string') return
        void urls?.refreshProject(event.projectId).catch((error: unknown) => ctx.log.warn(`preview URL refresh failed: ${error instanceof Error ? error.message : String(error)}`))
      })
    },
    dispose: () => {
      urls?.dispose()
      urls = null
    },
  }
}
