import { createEffect, createMemo, createRoot, createSignal, on } from 'solid-js'
import { taskBridge } from './taskBridge'
import { activeTaskId } from './tasks'
import { wsOnNodeEvent } from '../../infra/node/wsClient'
import { TASK_IDS_PER_READ, type TaskStatus } from '@acorn/protocol/task.ts'
import type { ClientScheduleContribution } from '../../host/registries/shell/schedules'
import { latestOnly } from '../../kit/lib/state/latestOnly'

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
  left.taskId === right.taskId &&
  left.worktreePath === right.worktreePath &&
  left.dirty === right.dirty &&
  left.dirtyCount === right.dirtyCount &&
  left.missing === right.missing &&
  left.branch === right.branch &&
  left.head === right.head

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
    taskStatusesChanged(current, list) ? Object.fromEntries(list.map((status) => [status.taskId, status])) : current,
  )
  setStatusRevision((revision) => revision + 1)
}

// The tasks the rail draws. Null until a rail says, and in a client without one, which asks about
// every active task.
const [railTaskIds, setRailTaskIds] = createSignal<readonly string[] | null>(null)
export { setRailTaskIds }

// The rail's rows and the open task, so a task nobody can see costs no `git status`. Undefined asks for
// every active task: no rail has said, or the list is too long to name in one read.
const statusTaskIds = (): readonly string[] | undefined => {
  const rail = railTaskIds()
  if (!rail) return undefined
  const open = activeTaskId()
  const ids = open && !rail.includes(open) ? [...rail, open] : rail
  return ids.length <= TASK_IDS_PER_READ ? ids : undefined
}

const refreshTaskStatuses = latestOnly(async () => {
  const ids = statusTaskIds()
  return ids && !ids.length ? [] : taskBridge().task.statuses(ids)
}, publishTaskStatuses)

// Start polling; returns an unsubscribe.
//
// No `requires`: `/v1/core/task-statuses` is a core HTTP route and works from any client. It stays a
// client clock on purpose: it refreshes what a window is drawing, and nothing needs it when no window
// is open (docs/schedules.md § Why the node, and only the node).
export const taskStatusScheduleContribution: ClientScheduleContribution = {
  id: 'tasks.worktree-status',
  intervalMs: 10_000,
  // The clock is a backstop to the events below, so it slows down while the window has no focus.
  unfocusedIntervalMs: 30_000,
  // Each refresh shells out to `git status` for every worktree it asks about. Status broadcasts keep
  // in-app mutations immediate; ten seconds bounds background process churn as task count grows.
  run: refreshTaskStatuses,
  // One narrow event, because what moves a dirty marker is a write under the worktree, and an agent
  // that writes files raises it too. Agent session frames and terminal status pings would fire on every
  // turn and every idle-to-working edge, each a `git status` per worktree per client. Core's own
  // transport, so no feature accessor.
  subscribe: (refresh) => {
    const off = wsOnNodeEvent('worktree:status-changed', () => refresh())
    // A task new to the rail, after a workspace switch, has no status until it's asked about.
    const stopAsking = createRoot((dispose) => {
      const asked = createMemo(() => {
        const ids = statusTaskIds()
        return ids && [...ids].sort().join(',')
      })
      createEffect(on(asked, () => refresh(), { defer: true }))
      return dispose
    })
    return () => {
      off()
      stopAsking()
    }
  },
}
