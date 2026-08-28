import { createSignal } from 'solid-js'
import { taskBridge } from './taskBridge'
import { wsOnStatus } from '../wsClient'
import type { TaskStatus } from '@acorn/protocol/terminal.ts'
import type { ClientScheduleContribution } from '../registries/schedules'
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
  && left.branch === right.branch
  && left.head === right.head

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
  async () => taskBridge().task.statuses(),
  (list) => setStatuses((current) =>
    taskStatusesChanged(current, list) ? Object.fromEntries(list.map((status) => [status.taskId, status])) : current),
)

// Start polling; returns an unsubscribe.
//
// No `requires`. This used to be gated on `desktop`, from when the read went through the shell's
// preload; `/v2/core/task-statuses` is a core HTTP route (server/routes/worktree.ts) and works from
// any client. It stays a client clock on purpose: it refreshes what a window is drawing, and nothing
// needs it when no window is open (docs/schedules.md § Why the node, and only the node).
export const taskStatusScheduleContribution: ClientScheduleContribution = {
  id: 'tasks.worktree-status',
  intervalMs: 10_000,
  // Each refresh shells out to `git status` for every active worktree. Status broadcasts keep
  // in-app mutations immediate; ten seconds bounds background process churn as task count grows.
  run: refreshTaskStatuses,
  // PTY status edges arrive on the shared WebSocket, which is core's own transport, no need to go
  // through a feature accessor for it.
  subscribe: (refresh) => wsOnStatus(refresh),
}
