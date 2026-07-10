import type { PaneContribution } from '../../../core/client/registries/panes'
import ChangesPane from './ChangesPane'

export const changesPaneContribution: PaneContribution = {
  id: 'changes', label: 'Changes', glyph: '⎇', description: 'Uncommitted working tree', order: 20,
  defaultChord: 'meta+shift+g', requires: 'desktop', component: ChangesPane,
}
