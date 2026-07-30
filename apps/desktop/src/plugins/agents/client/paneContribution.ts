import { lazy } from 'solid-js'
import type { PaneContribution } from '../../../core/client/registries/panes'

const AgentPane = lazy(() => import('./AgentPane'))

export const agentPaneContribution: PaneContribution = {
  id: 'agents',
  label: 'Agent',
  glyph: 'bot',
  description: 'Managed Claude Code and Codex sessions',
  order: 15,
  defaultChord: 'meta+shift+a',
  requires: 'desktop',
  component: AgentPane,
  minWidth: 640,
}
