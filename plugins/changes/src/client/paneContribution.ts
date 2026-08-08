import { lazy } from 'solid-js'
import type { PaneContribution } from '@acorn/plugin-api/client'

const ChangesPane = lazy(() => import('./ChangesPane'))

export const changesPaneContribution: PaneContribution = {
  id: 'changes', label: 'Changes', glyph: 'git-compare', description: 'Uncommitted working tree', order: 20,
  defaultChord: 'meta+shift+g', requires: 'desktop', component: ChangesPane,
}
