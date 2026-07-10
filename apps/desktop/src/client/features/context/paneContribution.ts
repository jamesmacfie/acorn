import type { PaneContribution } from '../../registries/panes'
import ContextPane from './ContextPane'

export const contextPaneContribution: PaneContribution = {
  id: 'context', label: 'Context', glyph: '⊞', description: 'What an assembled send includes', order: 40,
  defaultChord: 'meta+shift+x', component: ContextPane,
}
