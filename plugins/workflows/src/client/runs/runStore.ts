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
import { onPluginFrame, type ClientScheduleContribution } from '@acorn/plugin-api/client'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import { workflowApi } from '../workflowsClient'

const [runCounts, setRunCounts] = createSignal<Record<string, number>>({})

export const taskHasWorkflowRuns = (taskId: string): boolean => (runCounts()[taskId] ?? 0) > 0

const same = (a: Record<string, number>, b: Record<string, number>): boolean => {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

export const workflowRunCountsSchedule: ClientScheduleContribution = {
  id: 'workflows.task-runs',
  intervalMs: 120_000,
  requires: { plugin: 'workflows' },
  run: async () => {
    const { runs } = await workflowApi.allRuns().catch(() => ({ runs: [] }))
    const next: Record<string, number> = {}
    for (const run of runs) if (run.taskId) next[run.taskId] = (next[run.taskId] ?? 0) + 1
    // Same counts, same object: `when` is read on every pane-strip render, and a fresh object every
    // two minutes would rebuild the strip for nothing.
    setRunCounts((current) => (same(current, next) ? current : next))
  },
  subscribe: (refresh) => onPluginFrame('workflows', pluginChannel('workflows', 'run-changed'), refresh),
}
