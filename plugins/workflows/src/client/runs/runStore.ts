// Which tasks have a run, so the pane can be hidden on the ones that do not.
//
// `when` on a pane is synchronous and is asked while the task row is drawn, so the answer has to be
// in memory already (client-core registries/panes/panes.ts). One node-wide read fills it, the same
// route the rail's recent-run list uses, and the node's `run-changed` frame refreshes it. The
// interval is the backstop for a frame that arrived while another node was active.
//
// The route answers the last hundred runs on the node, so a task whose only run has fallen off that
// list loses its pane. That is the same window the rail and the merged run list show, and a longer
// one would mean a count query per task.
import { createSignal } from 'solid-js'
import {
  activateTaskSignals, onPluginFrame, openPane, pathForTask, wsOnReconnect, type ClientScheduleContribution, type Task,
} from '@acorn/plugin-api/client'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import { workflowApi } from '../workflowsClient'
import type { WorkflowTaskGroup } from '../../shared/api'

const [runCounts, setRunCounts] = createSignal<Record<string, number>>({})
const [taskGroups, setTaskGroups] = createSignal<Record<string, WorkflowTaskGroup>>({})
export { taskGroups as workflowTaskGroups }

export const taskHasWorkflowRuns = (taskId: string): boolean => (runCounts()[taskId] ?? 0) > 0

// A confirmed start or run link proves that this task has a run. Make its pane available before
// navigation; a later node read replaces the hint with authoritative counts.
let hintRevision = 0
export const rememberWorkflowRun = (taskId: string): void => {
  if (runCounts()[taskId]) return
  hintRevision += 1
  setRunCounts((current) => ({ ...current, [taskId]: 1 }))
}

/** Open a run in its task's Workflows pane. The shell draws what the rail source says, not the
 *  address, so navigating alone left the reader on Workflows with an empty list. These are the calls
 *  the agents center makes to open a session's run, in its order (plugins/agents center/AgentCenter.tsx). */
export function openWorkflowRun(task: Task, runId: string, navigate: (path: string) => void): void {
  rememberWorkflowRun(task.id)
  activateTaskSignals(task, { pane: 'workflows' })
  openPane(task.id, 'workflows', { kind: 'workflows:show-run', runId })
  navigate(pathForTask(task))
}

const same = (a: Record<string, number>, b: Record<string, number>): boolean => {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

export const workflowRunCountsSchedule: ClientScheduleContribution = {
  id: 'workflows.task-runs',
  intervalMs: 120_000,
  requires: { plugin: 'workflows' },
  run: async () => {
    const readRevision = hintRevision
    const [runList, navigation] = await Promise.all([
      workflowApi.allRuns().catch(() => null),
      workflowApi.taskNavigation().catch(() => null),
    ])
    // A read sent before a start cannot erase the confirmed run when its older answer arrives later.
    if (runList && readRevision === hintRevision) {
      const next: Record<string, number> = {}
      for (const run of runList.runs) if (run.taskId) next[run.taskId] = (next[run.taskId] ?? 0) + 1
      // Same counts, same object: `when` is read on every pane-strip render, and a fresh object every
      // two minutes would rebuild the strip for nothing.
      setRunCounts((current) => (same(current, next) ? current : next))
    }
    if (navigation) {
      const groups = Object.fromEntries(navigation.groups.map(group => [group.rootTaskId, group]))
      setTaskGroups(current => JSON.stringify(current) === JSON.stringify(groups) ? current : groups)
    }
  },
  subscribe: (refresh) => {
    const offRun = onPluginFrame('workflows', pluginChannel('workflows', 'run-changed'), refresh)
    const offChild = onPluginFrame('workflows', pluginChannel('workflows', 'child-changed'), refresh)
    const offReconnect = wsOnReconnect(refresh)
    return () => {
      offReconnect()
      offChild()
      offRun()
    }
  },
}
