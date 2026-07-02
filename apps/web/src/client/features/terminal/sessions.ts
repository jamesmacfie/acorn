// Shared terminal-session store. Lifted out of TerminalPanel so the rail and topbar can read live
// session state even when the drawer is closed — a single onStatus subscription + one session list,
// in the codebase's signals-only style (cf. ../tabs/tabs.ts).
import { createSignal } from 'solid-js'
import { terminalApi } from './terminalClient'
import type { TerminalSession } from '../../../shared/terminal'

const [sessions, setSessions] = createSignal<TerminalSession[]>([])
export { sessions }

export async function refreshSessions(): Promise<void> {
  const api = terminalApi()
  if (!api) return
  setSessions(await api.list())
}

// Pull once then track main-process idle/exit broadcasts. Returns an unsubscribe; a noop when the
// terminal bridge is absent (web build / flag off), so consumers naturally show nothing.
export function initSessions(): () => void {
  const api = terminalApi()
  if (!api) return () => {}
  void refreshSessions()
  return api.onStatus(() => void refreshSessions())
}

// Target-picker data for sendToAgent (docs/next 04 §D): the task's running agent sessions,
// most-recent first (the default target), each with its idle dot.
export function agentSessionsFor(taskId: string | null): TerminalSession[] {
  if (!taskId) return []
  return sessions()
    .filter((s) => s.kind === 'agent' && s.status === 'running' && s.taskId === taskId)
    .sort((a, b) => b.createdAt - a.createdAt)
}

// Agents actively working in a task (docs/workspaces). "Working" = a running agent that
// isn't idle. Keys off taskId, not the URL — the rail's per-task spinner and the topbar
// badge both read this.
export function workingCountFor(taskId: string | null): number {
  if (!taskId) return 0
  return sessions().filter(
    (s) => s.kind === 'agent' && s.status === 'running' && !s.idle && s.taskId === taskId,
  ).length
}
