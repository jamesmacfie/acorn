import { lazy } from 'solid-js'
import { createContextModel, type ContextModel } from './contextModel'
import type { PaneLayoutContribution } from '@acorn/plugin-api/client'

// Context as a `header-body-footer` pane: the summary line does not scroll, the sections do, and the
// sync bar is pinned under them (docs/panes.md § Layout model).
const ContextHeader = lazy(async () => ({ default: (await import('./ContextPane')).ContextHeader }))
const ContextBody = lazy(async () => ({ default: (await import('./ContextPane')).ContextBody }))
const ContextFooter = lazy(async () => ({ default: (await import('./ContextPane')).ContextFooter }))

export const contextPaneContribution: PaneLayoutContribution<ContextModel> = {
  id: 'context', label: 'Context', glyph: 'layout-grid', description: 'What an assembled send includes', order: 40,
  defaultChord: 'meta+shift+x',
  layout: 'header-body-footer',
  // The inventory, the selection, the expanded rows and the sync state, held once per task by the host
  // (client-core registries/paneModels.ts).
  model: (task) => createContextModel(task),
  regions: { header: ContextHeader, body: ContextBody, footer: ContextFooter },
}
