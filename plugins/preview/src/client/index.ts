// The preview plugin's client part (docs/plugins/plugin-api.md § The plugin API).
import { activeNodeId, activeTaskId, clientEvents, openPane, previewViews, readJson, toast, type ClientPlugin, writeJson } from '@acorn/plugin-api/client'
import { PREVIEW_RECIPE_SELECTION } from '@acorn/plugin-terminal/contract/previewSelection.ts'
import { previewConfigured, previewConfiguredSchedule } from './configuredStore'
import { previewPaneContribution } from './paneContribution'
import type { PreviewUrlState } from '../contract/urls'
import { previewRecipeUrlRoute, previewUrlRoute } from '../shared/api'

export const previewClientPlugin: ClientPlugin = {
  name: 'preview',
  init: (ctx) => {
    ctx.capabilities.provide(PREVIEW_RECIPE_SELECTION, {
      set: async (taskId, url) => {
        await writeJson(previewRecipeUrlRoute(taskId), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url }),
        })
      },
    })
    ctx.panes.register(previewPaneContribution)
    ctx.contextMenus.register({
      id: 'preview.copy-url', location: 'rail.pane', surface: 'preview',
      label: 'Copy URL', icon: 'copy', order: 130,
      run: async (target) => {
        if (target.location !== 'rail.pane') return
        try {
          const address = readJson<PreviewUrlState | null>(previewUrlRoute(target.taskId), { nodeId: target.nodeId }).then((state) => {
            if (!state?.url || state.taskId !== target.taskId) throw new Error('No preview URL available')
            return new Blob([state.url], { type: 'text/plain' })
          })
          // Start the write during the click. WebKit loses clipboard permission after an async read.
          await navigator.clipboard.write([new ClipboardItem({ 'text/plain': address })])
          toast('Copied the preview URL')
        } catch {
          toast('Could not copy the preview URL')
        }
      },
    })
    ctx.schedules.register(previewConfiguredSchedule)
    // One row, gated on the same seam the pane is: a terminal installs no preview seam, so this is
    // absent there rather than present and useless (docs/tui/plugin-losses.md § What a plugin loses here). URL rules
    // are repository configuration and reloading needs a mounted preview, so neither is a command
    // (docs/command-palette-and-shortcuts.md).
    ctx.commands.register({
      id: 'preview.open',
      title: 'Open Preview',
      hint: 'the running app for this task',
      keywords: ['preview', 'browser'],
      category: 'navigation',
      palette: true,
      scope: 'task',
      requires: { seam: 'preview' },
      // The pane's own gate, so the palette does not offer a pane the task cannot show.
      when: () => {
        const taskId = activeTaskId()
        return !!taskId && previewConfigured(taskId)
      },
      run: (context) => {
        if (context.taskId) openPane(context.taskId, 'preview')
      },
    })
    // Drop an archived task's preview view. Every archive path raises this event.
    clientEvents.on('runtime:node-switched', () => previewViews()?.evictAll())
    clientEvents.on('runtime:node-removed', ({ nodeId }) => {
      if (nodeId === activeNodeId()) previewViews()?.evictAll()
    })
    clientEvents.on('runtime:task-archived', ({ taskId }) => previewViews()?.evict(taskId))
  },
}
