import { lazy } from 'solid-js'
import type { PaneLayoutContribution } from '@acorn/plugin-api/client'

// Changes as a `list-detail` pane: the host draws the split, the divider and the drag handle, and these
// four components fill the regions (docs/panes.md § Layout model).
const ChangesHeader = lazy(async () => ({ default: (await import('./ChangesPane')).ChangesHeader }))
const ChangesList = lazy(async () => ({ default: (await import('./ChangesPane')).ChangesList }))
const ChangesFooter = lazy(async () => ({ default: (await import('./ChangesPane')).ChangesFooter }))
const ChangesDiff = lazy(async () => ({ default: (await import('./ChangesPane')).ChangesDiff }))

export const changesPaneContribution: PaneLayoutContribution = {
  id: 'changes', label: 'Changes', glyph: 'git-compare', description: 'Uncommitted working tree', order: 20,
  defaultChord: 'meta+shift+g', requires: { plugin: 'changes' },
  layout: 'list-detail',
  regions: { 'list-header': ChangesHeader, list: ChangesList, 'list-footer': ChangesFooter, detail: ChangesDiff },
}
