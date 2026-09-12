// The preview plugin's client part (docs/plugins.md § The plugin API).
import { openPane, type ClientPlugin, writeJson } from '@acorn/plugin-api/client'
import { PREVIEW_RECIPE_SELECTION } from '@acorn/plugin-terminal/contract/previewSelection.ts'
import { activatePreviewEvents } from './PreviewPane'
import { previewPaneContribution } from './PreviewTaskPane'
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
    // One row, gated on the same seam the pane is: a terminal installs no preview seam, so this is
    // absent there rather than present and useless (docs/tui.md § What a plugin loses here). URL rules
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
      run: (context) => {
        if (context.taskId) openPane(context.taskId, 'preview')
      },
    })
    activatePreviewEvents()
  },
}
