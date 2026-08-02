import { lazy } from 'solid-js'
import type { PaneContribution } from '@acorn/client-core/registries/panes.ts'

const ChangesPane = lazy(() => import('./ChangesPane'))

export const changesPaneContribution: PaneContribution = {
  id: 'changes', label: 'Changes', glyph: 'git-compare', description: 'Uncommitted working tree', order: 20,
  defaultChord: 'meta+shift+g', requires: 'desktop', component: ChangesPane,
}
