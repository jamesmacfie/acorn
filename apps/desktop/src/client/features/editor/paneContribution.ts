import type { PaneContribution } from '../../registries/panes'
import EditorPane from './EditorPane'

export const editorPaneContribution: PaneContribution = {
  id: 'editor', label: 'Editor', glyph: '✎', description: 'In-app code editor', order: 50,
  defaultChord: 'meta+shift+e', requires: 'desktop', component: EditorPane, minWidth: 320,
}
