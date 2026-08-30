import { lazy } from 'solid-js'
import { createChangesModel, type ChangesModel } from './changesModel'
import type { PaneLayoutContribution } from '@acorn/plugin-api/client'

// Changes as a `list-detail` pane: the host draws the split, the divider and the drag handle, and these
// four components fill the regions (docs/panes.md § Layout model).
const ChangesHeader = lazy(async () => ({ default: (await import('./ChangesPane')).ChangesHeader }))
const ChangesList = lazy(async () => ({ default: (await import('./ChangesPane')).ChangesList }))
const ChangesFooter = lazy(async () => ({ default: (await import('./ChangesPane')).ChangesFooter }))
const ChangesDiff = lazy(async () => ({ default: (await import('./ChangesPane')).ChangesDiff }))

export const changesPaneContribution: PaneLayoutContribution<ChangesModel> = {
  id: 'changes', label: 'Changes', glyph: 'git-compare', description: 'Uncommitted working tree', order: 20,
  defaultChord: 'meta+shift+g', requires: { plugin: 'changes' },
  layout: 'list-detail',
  // The change list, the selection, the diff source and the armed commit confirm, held once per task
  // by the host (client-core registries/paneModels.ts).
  model: (task) => createChangesModel(task),
  regions: { 'list-header': ChangesHeader, list: ChangesList, 'list-footer': ChangesFooter, detail: ChangesDiff },
}
