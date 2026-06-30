// Live worktree status per workspace (docs/workspaces 02/05): dirty + changed-file count, and
// `missing` (worktree removed outside acorn → needs repair). The rail markers and the workspace
// footer read this. Signals-only, like ../terminal/sessions.ts. Polled on a short interval (git
// file changes don't ping onStatus) plus on onStatus edges. ponytail: 5s poll over a few worktrees
// is cheap; tighten to a watcher only if it ever matters.
import { createSignal } from 'solid-js'
import { terminalApi } from '../terminal/terminalClient'
import type { WorkspaceStatus } from '../../../shared/terminal'

const [statuses, setStatuses] = createSignal<Record<string, WorkspaceStatus>>({})
export { statuses }

export const workspaceStatus = (id: string): WorkspaceStatus | undefined => statuses()[id]

async function refresh(): Promise<void> {
  const api = terminalApi()
  if (!api) return
  const list = await api.workspace.statuses()
  setStatuses(Object.fromEntries(list.map((s) => [s.workspaceId, s])))
}

// Start polling; returns an unsubscribe. No-op when the terminal bridge is absent (web build).
export function initWorkspaceStatuses(): () => void {
  const api = terminalApi()
  if (!api) return () => {}
  void refresh()
  const off = api.onStatus(() => void refresh())
  const timer = setInterval(() => void refresh(), 5000)
  return () => {
    off()
    clearInterval(timer)
  }
}
