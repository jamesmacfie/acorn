import { lazy } from 'solid-js'
import type { PaneContribution } from '@acorn/plugin-api/client'

const AgentPane = lazy(() => import('./AgentPane'))

/** The pane id, spelled once: the collection's row action and the pane-intent listener both name it
 *  (collectionContribution.ts, managedSelection.ts). */
export const AGENT_PANE_ID = 'agents'

export const agentPaneContribution: PaneContribution = {
  id: AGENT_PANE_ID,
  label: 'Agent',
  glyph: 'bot',
  description: 'Managed Claude Code and Codex sessions',
  order: 15,
  defaultChord: 'meta+shift+a',
  requires: 'desktop',
  component: AgentPane,
  minWidth: 640,
}
