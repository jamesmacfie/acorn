// The preview plugin's client part (docs/plugins.md § The plugin API).
import type { ClientPlugin } from '@acorn/client-core/registries/plugin.ts'
import { activatePreviewEvents } from './PreviewPane'
import { previewPaneContribution } from './PreviewTaskPane'

export const previewClientPlugin: ClientPlugin = {
  name: 'preview',
  init: (ctx) => {
    ctx.panes.register(previewPaneContribution)
    activatePreviewEvents()
  },
}
