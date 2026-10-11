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
  activateTaskSignals, activeNodeId, clientEvents, latestSignal, onPluginFrame, openPane, pathForTask, wsOnReconnect,
  type ClientScheduleContribution, type Task,
} from '@acorn/plugin-api/client'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'
import { createWorkflowApi } from '../workflowsClient'
import { workflowRefreshQueue } from '../refreshQueue'
import type { WorkflowTaskGroup } from '../../shared/api'

const [runCounts, setRunCounts] = createSignal<Record<string, number>>({})
const [taskGroups, setTaskGroups] = createSignal<Record<string, WorkflowTaskGroup>>({})
export const workflowTaskGroups = () => cacheNodeId === activeNodeId() ? taskGroups() : {}

let cacheNodeId = activeNodeId()
export const taskHasWorkflowRuns = (taskId: string): boolean => cacheNodeId === activeNodeId() && (runCounts()[taskId] ?? 0) > 0

// A confirmed start or run link proves that this task has a run. Make its pane available before
// navigation; a later node read replaces the hint with authoritative counts. Each hint aborts the
// counts of reads sent before it.
const sinceLastHint = latestSignal()
export const rememberWorkflowRun = (taskId: string): void => {
  if (cacheNodeId !== activeNodeId()) { cacheNodeId = activeNodeId(); setRunCounts({}); setTaskGroups({}) }
  if (runCounts()[taskId]) return
  sinceLastHint.next()
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

// The reader's lifetime. A node switch, or the first subscriber arriving or the last leaving, ends it.
const readerLifetime = latestSignal()
let subscribers = 0
let everSubscribed = false
let reader: { nodeId: string | null; lifetime: AbortSignal; queue: ReturnType<typeof workflowRefreshQueue> } | undefined

export const workflowRunCountsSchedule: ClientScheduleContribution = {
  id: 'workflows.task-runs',
  intervalMs: 120_000,
  requires: { plugin: 'workflows' },
  run: () => {
    const nodeId = activeNodeId()
    if (!reader || reader.nodeId !== nodeId || reader.lifetime.aborted) {
      reader?.queue.stop()
      const lifetime = readerLifetime.signal
      const api = createWorkflowApi()
      reader = { nodeId, lifetime, queue: workflowRefreshQueue(async () => {
        const counts = sinceLastHint.signal
        const [runList, navigation] = await Promise.all([
          api.allRuns().catch(() => null),
          api.taskNavigation().catch(() => null),
        ])
        if (activeNodeId() !== nodeId || lifetime.aborted || (everSubscribed && !subscribers)) return
        if (cacheNodeId !== nodeId) { cacheNodeId = nodeId; setRunCounts({}); setTaskGroups({}) }
        // A read sent before a start cannot erase the confirmed run when its older answer arrives later.
        if (runList && !counts.aborted) {
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
      }) }
    }
    return reader.queue.refresh()
  },
  subscribe: (refresh) => {
    if (!subscribers) readerLifetime.next()
    subscribers += 1
    everSubscribed = true
    const offNode = clientEvents.on('runtime:node-switched', () => {
      readerLifetime.next()
      reader?.queue.stop()
      cacheNodeId = activeNodeId()
      setRunCounts({})
      setTaskGroups({})
    })
    const offRun = onPluginFrame('workflows', pluginChannel('workflows', 'run-changed'), refresh)
    const offChild = onPluginFrame('workflows', pluginChannel('workflows', 'child-changed'), refresh)
    const offReconnect = wsOnReconnect(refresh)
    let stopped = false
    return () => {
      if (stopped) return
      stopped = true
      subscribers -= 1
      if (!subscribers) { readerLifetime.next(); reader?.queue.stop() }
      offNode()
      offReconnect()
      offChild()
      offRun()
    }
  },
}
