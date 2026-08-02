import { lazy } from 'solid-js'
import type { PaneContribution } from '@acorn/client-core/registries/panes.ts'

const HttpTaskPane = lazy(() => import('./HttpTaskPane'))

// No `requires: 'desktop'`: the executor is plain Node in the Hono server with no bridge, so this
// pane works under `dev:node` too. Command-derived variables need a checkout, but that degrades to
// an error on that one variable rather than making the pane useless.
export const httpPaneContribution: PaneContribution = {
  id: 'http',
  label: 'API',
  glyph: 'send',
  description: 'Send HTTP requests against this task',
  order: 76, // 75 is docker's
  defaultChord: 'meta+shift+h',
  component: HttpTaskPane,
  minWidth: 420,
}
