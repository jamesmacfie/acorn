import { lazy } from 'solid-js'
import { createAgentPaneModel, type AgentPaneModel } from './agentPaneModel'
import type { PaneLayoutContribution } from '@acorn/plugin-api/client'

/** The pane id, spelled once: the collection's row action and the pane-intent listener both name it
 *  (collectionContribution.ts, managedSelection.ts). */
export const AGENT_PANE_ID = 'agents'

const AgentPaneDetail = lazy(() => import('./AgentPane'))
const AgentTaskSidebar = lazy(() => import('./AgentTaskSidebar'))
const AgentSidebarHeader = lazy(async () => ({ default: (await import('./AgentTaskSidebar')).AgentSidebarHeader }))

// `list-detail`, with the sessions in this task on the left and the open one on the right
// (docs/panes.md § Layout model). The header over the list is its own region so it stays put while
// the list scrolls; the conversation's own header, transcript and composer are siblings inside the
// detail region, because the transcript owns the scroll and the other two are pinned by sitting
// beside it.
export const agentPaneContribution: PaneLayoutContribution<AgentPaneModel> = {
  id: AGENT_PANE_ID,
  label: 'Agent',
  glyph: 'bot',
  description: 'Managed Claude Code and Codex sessions',
  order: 15,
  defaultChord: 'meta+shift+a',
  requires: { plugin: 'agents' },
  minWidth: 640,
  layout: 'list-detail',
  // The session list, which one is open, its snapshot subscription and the rename/archive dialog,
  // held once per task by the host (client-core registries/paneModels.ts).
  model: (task) => createAgentPaneModel(task),
  regions: {
    'list-header': AgentSidebarHeader,
    list: AgentTaskSidebar,
    detail: AgentPaneDetail,
  },
}
