import { createSignal } from 'solid-js'
import { taskBridge } from './taskBridge'
import { wsOnNodeEvent } from '../../infra/node/wsClient'
import type { TaskStatus } from '@acorn/protocol/terminal.ts'
import type { ClientScheduleContribution } from '../../host/registries/shell/schedules'
import { latestOnly } from '../../kit/lib/latestOnly'

const [statuses, setStatuses] = createSignal<Record<string, TaskStatus>>({})
export { statuses }

// The snapshot above deliberately keeps its identity when the rail-visible summary did not move,
// so every task row is not redrawn on a ten-second poll. A consumer that reads more than that
// summary still needs to hear the poll itself: the Changes pane's file names and line counts can
// change while dirty/count/branch/HEAD all stay the same.
const [statusRevision, setStatusRevision] = createSignal(0)
export const taskStatusRevision = statusRevision

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

/** Publish one completed poll. The rail snapshot moves only when its fields changed; the revision
 * always moves so consumers of the full working tree can refresh on the same clock. */
export function publishTaskStatuses(list: readonly TaskStatus[]): void {
  setStatuses((current) =>
    taskStatusesChanged(current, list) ? Object.fromEntries(list.map((status) => [status.taskId, status])) : current)
  setStatusRevision((revision) => revision + 1)
}

export const refreshTaskStatuses = latestOnly(
  async () => taskBridge().task.statuses(),
  publishTaskStatuses,
)

// Start polling; returns an unsubscribe.
//
// No `requires`. This used to be gated on `desktop`, from when the read went through the shell's
// preload; `/v2/core/task-statuses` is a core HTTP route (server/routes/projects/worktree.ts) and works from
// any client. It stays a client clock on purpose: it refreshes what a window is drawing, and nothing
// needs it when no window is open (docs/schedules.md § Why the node, and only the node).
export const taskStatusScheduleContribution: ClientScheduleContribution = {
  id: 'tasks.worktree-status',
  intervalMs: 10_000,
  // Each refresh shells out to `git status` for every active worktree. Status broadcasts keep
  // in-app mutations immediate; ten seconds bounds background process churn as task count grows.
  run: refreshTaskStatuses,
  // Two narrow events rather than the old content-free `term:status` ping, which also fired on every
  // terminal idle-to-working edge and made a build's output spawn a `git status` per worktree per
  // client (docs/performance.md § 2026-09-03 — phase 5). What actually moves a dirty
  // marker is a write under the worktree, or an agent finishing a turn. Core's own transport, so no
  // feature accessor.
  subscribe: (refresh) => {
    const offs = [
      wsOnNodeEvent('worktree:status-changed', () => refresh()),
      wsOnNodeEvent('agent-session:changed', () => refresh()),
    ]
    return () => offs.forEach((off) => off())
  },
}
