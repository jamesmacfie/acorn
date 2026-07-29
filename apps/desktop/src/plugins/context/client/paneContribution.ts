import { lazy } from 'solid-js'
import type { PaneContribution } from '../../../core/client/registries/panes'

const ContextPane = lazy(() => import('./ContextPane'))

export const contextPaneContribution: PaneContribution = {
  id: 'context', label: 'Context', glyph: 'layout-grid', description: 'What an assembled send includes', order: 40,
  defaultChord: 'meta+shift+x', component: ContextPane,
}
