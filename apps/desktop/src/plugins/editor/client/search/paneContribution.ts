import { lazy } from 'solid-js'
import type { PaneContribution } from '../../../../core/client/registries/panes'

const SearchPane = lazy(() => import('./SearchPane'))

export const searchPaneContribution: PaneContribution = {
  id: 'search', label: 'Find in Files', glyph: 'search', description: 'Search file contents across the worktree', order: 60,
  defaultChord: 'meta+shift+f', requires: 'desktop', component: SearchPane,
}
