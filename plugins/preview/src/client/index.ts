// The preview plugin's client part (docs/plugins/plugin-api.md § The plugin API).
import { activeNodeId, activeTaskId, clientEvents, openPane, previewViews, type ClientPlugin, writeJson } from '@acorn/plugin-api/client'
import { PREVIEW_RECIPE_SELECTION } from '@acorn/plugin-terminal/contract/previewSelection.ts'
import { previewConfigured, previewConfiguredSchedule } from './configuredStore'
import { previewPaneContribution } from './paneContribution'
import { previewRecipeUrlRoute } from '../shared/api'

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
