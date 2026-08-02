import { lazy } from 'solid-js'
import type { PaneContribution } from '@acorn/client-core/registries/panes.ts'

const EditorPane = lazy(() => import('./EditorPane'))

export const editorPaneContribution: PaneContribution = {
  id: 'editor', label: 'Editor', glyph: 'pencil', description: 'In-app code editor', order: 50,
  defaultChord: 'meta+shift+e', requires: 'desktop', component: EditorPane, minWidth: 320,
}
