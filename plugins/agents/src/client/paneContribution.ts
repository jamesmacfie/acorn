import { lazy } from 'solid-js'
import { createAgentPaneModel, type AgentPaneModel } from './sessions/agentPaneModel'
import { managedAgentStore } from './sessions/managedStore'
import type { PaneLayoutContribution } from '@acorn/plugin-api/client'
import { AGENT_PANE_ID } from '../shared/paneIdentity'

export { AGENT_PANE_ID } from '../shared/paneIdentity'

const AgentPaneDetail = lazy(() => import('./sessions/AgentPane'))
const AgentTaskSidebar = lazy(() => import('./sessions/AgentTaskSidebar'))
const AgentSidebarHeader = lazy(async () => ({
  default: (await import('./sessions/AgentTaskSidebar')).AgentSidebarHeader,
}))

// `list-detail`, with the sessions in this task on the left and the open one on the right
// (docs/panes/layout.md § Layout model). The header over the list is its own region so it stays put
// while the list scrolls; the conversation's own header, transcript and composer are siblings inside
// the detail region, because the transcript owns the scroll and the other two are pinned by sitting
// beside it.
export const agentPaneContribution: PaneLayoutContribution<AgentPaneModel> = {
  id: AGENT_PANE_ID,
  label: 'Agent',
  glyph: 'bot',
  description: 'Agent sessions for this task',
  order: 15,
  defaultChord: 'meta+shift+a',
  requires: { plugin: 'agents' },
  // Transcripts are stored rows, so an archived task's sessions read as they were. The detail region
  // turns the composer off for one.
  readsArchived: true,
  // The detail region says when the pane is usable.
  reportsUsable: true,
  minWidth: 640,
  layout: 'list-detail',
  // The session list, which one is open, its snapshot subscription and the rename/archive dialog,
  // held once per task by the host (client-core's `paneModel`).
  model: (task, pane) => createAgentPaneModel(task, pane),
  // The session list, which is the first thing the model asks for. The store deduplicates it over a
  // short window (`TASK_LOAD_WINDOW_MS`), so opening the task right after the hover costs nothing. Not
  // the snapshot: warming it gains little, but a hover with no click would then read the whole
  // transcript, which the store keeps until the app quits.
  prefetch: (task) => void managedAgentStore.loadTask(task.id).catch(() => {}),
  // The sidebar gives each row its run-state glyph back as a rail form.
  collapsible: true,
  selection: (_task, model) => model.selectedSessionId() ?? null,
  regions: {
    'list-header': AgentSidebarHeader,
    list: AgentTaskSidebar,
    detail: AgentPaneDetail,
  },
}
