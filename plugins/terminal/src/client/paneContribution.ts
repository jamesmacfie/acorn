import { lazy } from 'solid-js'
import type { PaneLayoutContribution } from '@acorn/plugin-api/client'

// Loaded once a task opens the pane, so the phone's first screen doesn't carry xterm
// (docs/frontend/startup-budget.md § The phone).
const TerminalPane = lazy(() => import('./TerminalPane'))

// The task's terminal sessions on a phone. The desktop draws the same sessions in its drawer, and a
// phone draws no drawers, so this pane is for phones only.
export const terminalPaneContribution: PaneLayoutContribution = {
  id: 'terminal',
  label: 'Terminal',
  glyph: 'terminal',
  description: "The task's terminal sessions",
  // Last in the bar, so opening a task never lands here: the pane may start a shell when it opens.
  order: 90,
  requires: { plugin: 'terminal' },
  formFactor: ['narrow'],
  layout: 'single',
  regions: { body: TerminalPane },
}
