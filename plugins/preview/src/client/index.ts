// The preview plugin's client part (docs/vNext/plugins.md § The plugin API).
import type { ClientPlugin } from '@acorn/client-core/registries/plugin.ts'
import { activatePreviewEvents } from './PreviewPane'
import { previewPaneContribution } from './PreviewTaskPane'

export const previewClientPlugin: ClientPlugin = {
  name: 'preview',
  init: (ctx) => {
    ctx.panes.register(previewPaneContribution)
    // Activation: subscribes to main's preview-chrome pushes and to task archival, so a
    // WebContentsView is evicted when its task goes away. It returns a disposer, which nothing has ever
    // called — the subscription lives for the window's lifetime, and the host has no teardown phase to
    // hand it to. Dropping it keeps that fact visible rather than storing a handle nobody uses.
    activatePreviewEvents()
  },
}
