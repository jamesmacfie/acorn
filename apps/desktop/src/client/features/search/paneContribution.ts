import type { PaneContribution } from '../../registries/panes'
import SearchPane from './SearchPane'

export const searchPaneContribution: PaneContribution = {
  id: 'search', label: 'Find in Files', glyph: '⌕', description: 'Search file contents across the worktree', order: 60,
  defaultChord: 'meta+shift+f', requires: 'desktop', component: SearchPane,
}
