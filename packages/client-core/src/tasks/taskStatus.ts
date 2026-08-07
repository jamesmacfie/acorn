import { createSignal } from 'solid-js'
import { taskBridge } from './taskBridge'
import { wsOnStatus } from '../wsClient'
import type { TaskStatus } from '@acorn/protocol/terminal.ts'
import type { PollerContribution } from '../registries/pollers'
import { latestOnly } from '../lib/latestOnly'

const [statuses, setStatuses] = createSignal<Record<string, TaskStatus>>({})
export { statuses }

export const taskStatus = (id: string): TaskStatus | undefined => statuses()[id]

const sameTaskStatus = (left: TaskStatus, right: TaskStatus): boolean =>
  left.taskId === right.taskId
  && left.worktreePath === right.worktreePath
  && left.dirty === right.dirty
  && left.dirtyCount === right.dirtyCount
  && left.missing === right.missing

export function taskStatusesChanged(
  current: Readonly<Record<string, TaskStatus>>,
  next: readonly TaskStatus[],
): boolean {
  if (Object.keys(current).length !== next.length) return true
  return next.some((status) => {
    const previous = current[status.taskId]
    return !previous || !sameTaskStatus(previous, status)
  })
}

export const refreshTaskStatuses = latestOnly(
  async () => taskBridge()?.task.statuses() ?? [],
  (list) => setStatuses((current) =>
    taskStatusesChanged(current, list) ? Object.fromEntries(list.map((status) => [status.taskId, status])) : current),
)

// Start polling; returns an unsubscribe. No-op when the terminal bridge is absent (web build).
export const taskStatusPollerContribution: PollerContribution = {
  id: 'tasks.worktree-status',
  // Each refresh shells out to `git status` for every active worktree. Status broadcasts keep
  // in-app mutations immediate; ten seconds bounds background process churn as task count grows.
  intervalMs: 10_000,
  requires: 'desktop',
  run: refreshTaskStatuses,
  // PTY status edges arrive on the shared WebSocket, which is core's own transport — no need to go
  // through a feature accessor for it.
  subscribe: (refresh) => wsOnStatus(refresh),
}
