import { lazy } from 'solid-js'
import type { PaneLayoutContribution } from '@acorn/plugin-api/client'
import { createRunPaneModel, WORKFLOWS_PANE_ID, type RunPaneModel } from './runPaneModel'
import { taskHasWorkflowRuns } from './runStore'

// Workflow runs as a `list-detail` pane: the host draws the split and these four regions fill it
// (docs/panes.md § Layout model).
//
// `when` hides it on a task that has never run a workflow, which is most of them, so the pane strip
// does not grow a button per task (./runStore.ts holds the answer in memory).
const RunPaneHeader = lazy(async () => ({ default: (await import('./RunPane')).RunPaneHeader }))
const RunPaneList = lazy(async () => ({ default: (await import('./RunPane')).RunPaneList }))
const RunPaneFooter = lazy(async () => ({ default: (await import('./RunPane')).RunPaneFooter }))
const NodeDetail = lazy(() => import('./NodeDetail'))

export const workflowsPaneContribution: PaneLayoutContribution<RunPaneModel> = {
  id: WORKFLOWS_PANE_ID,
  label: 'Workflows',
  glyph: 'workflow',
  description: 'Workflow runs on this task',
  order: 25,
  requires: { plugin: 'workflows' },
  when: (task) => taskHasWorkflowRuns(task.id),
  // The same floor the agents pane declares, for the same reason: an agent node draws the whole
  // conversation here now, and a composer in a narrow column is unusable.
  minWidth: 640,
  layout: 'list-detail',
  // The runs, the selection, the live tail and the four verbs, built once per task by the host
  // (client-core registries/panes/paneModels.ts).
  model: (task) => createRunPaneModel(task),
  regions: { 'list-header': RunPaneHeader, list: RunPaneList, 'list-footer': RunPaneFooter, detail: NodeDetail },
}
