// Live worktree status per task (docs/workspaces 02/05): dirty + changed-file count, and
// `missing` (worktree removed outside acorn → needs repair). The rail markers and the task
// footer read this. Signals-only, like ../terminal/sessions.ts. Polled on a short interval (git
// file changes don't ping onStatus) plus on onStatus edges. ponytail: 5s poll over a few worktrees
// is cheap; tighten to a watcher only if it ever matters.
import { createSignal } from 'solid-js'
import { terminalApi } from '../../../plugins/terminal/client/terminalClient'
import type { TaskStatus } from '../../shared/terminal'
import type { PollerContribution } from '../registries/pollers'

const [statuses, setStatuses] = createSignal<Record<string, TaskStatus>>({})
export { statuses }

export const taskStatus = (id: string): TaskStatus | undefined => statuses()[id]

export async function refreshTaskStatuses(): Promise<void> {
  const api = terminalApi()
  if (!api) return
  const list = await api.task.statuses()
  setStatuses(Object.fromEntries(list.map((s) => [s.taskId, s])))
}

// Start polling; returns an unsubscribe. No-op when the terminal bridge is absent (web build).
export const taskStatusPollerContribution: PollerContribution = {
  id: 'tasks.worktree-status',
  intervalMs: 5000,
  requires: 'desktop',
  run: refreshTaskStatuses,
  subscribe: (refresh) => terminalApi()?.onStatus(refresh) ?? (() => {}),
}
