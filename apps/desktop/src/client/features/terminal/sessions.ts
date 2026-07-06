// Shared terminal-session store. Lifted out of TerminalPanel so the rail and topbar can read live
// session state even when the drawer is closed — a single onStatus subscription + one session list,
// in the codebase's signals-only style (cf. ../tabs/tabs.ts).
import { createSignal } from 'solid-js'
import { terminalApi } from './terminalClient'
import { trackSessionEdges } from '../notifications/notifications'
import type { TerminalSession } from '../../../shared/terminal'

const [sessions, setSessions] = createSignal<TerminalSession[]>([])
export { sessions }

export async function refreshSessions(): Promise<void> {
  const api = terminalApi()
  if (!api) return
  const next = await api.list()
  // Notification centre (docs/terminal-and-agents.md): edge-detect against the previous snapshot on every refresh.
  trackSessionEdges(sessions(), next)
  setSessions(next)
}

// Pull once then track main-process idle/exit broadcasts. Returns an unsubscribe; a noop when the
// terminal bridge is absent (web build / flag off), so consumers naturally show nothing.
export function initSessions(): () => void {
  const api = terminalApi()
  if (!api) return () => {}
  void refreshSessions()
  return api.onStatus(() => void refreshSessions())
}

// Which terminal tab was last viewed, per task (session-only, like isTerminalOpen). Lets the drawer
// reopen on the same tab after a task/workspace switch instead of snapping back to the first.
const activeByTask = new Map<string, string>()
export const activeTerminal = (taskId: string): string | undefined => activeByTask.get(taskId)
export const rememberActiveTerminal = (taskId: string, sessionId: string): void => {
  activeByTask.set(taskId, sessionId)
}

// A session the drawer should switch to and focus once it appears — the command palette creates
// terminals but can't reach TerminalPanel's local activeId, so it requests focus here. One-shot:
// the drawer clears it on apply.
const [pendingTerminalFocus, setPendingTerminalFocus] = createSignal<string | null>(null)
export { pendingTerminalFocus }
export const requestTerminalFocus = (sessionId: string): void => {
  setPendingTerminalFocus(sessionId)
}
export const clearTerminalFocus = (): void => {
  setPendingTerminalFocus(null)
}

// Target-picker data for sendToAgent (docs/panes.md): the task's running agent sessions,
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
