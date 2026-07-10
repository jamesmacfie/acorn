import type { PaneContribution } from '../../../core/client/registries/panes'
import DatabasePane from './DatabasePane'

export const databasePaneContribution: PaneContribution = {
  id: 'database', label: 'Database', glyph: '▦', description: 'Browse and edit the task database', order: 70,
  defaultChord: 'meta+shift+j', requires: 'desktop', component: DatabasePane, minWidth: 320,
}
