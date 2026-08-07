// "Which agents are running in this task" — platform state, not terminal-drawer internals. The rail
// spinner, the topbar badge, the notification edge tracker, the archive/quit concerns and the
// send-to-agent target pickers in the changes and context panes all read it, so it lives in core, in
// the codebase's signals-only style (cf. ./tasks.ts). One status subscription, one session list.
//
// It reads the session route and the status stream directly because both are core's own transports,
// so no feature accessor is needed. `capabilities().terminal` is the same probe taskBridge() and
// terminalApi() use (pinned by ./taskBridge.test.ts), so off-desktop behaviour is unchanged: an
// empty list and no subscription.
import { createSignal } from 'solid-js'
import { capabilities } from '../capabilities'
import { readJson } from '../apiClient'
import { terminalSessionsRoute } from '@acorn/protocol/api.ts'
import { wsOnStatus } from '../wsClient'
import { trackSessionEdges } from '../notifications/notifications'
import type { TerminalSession } from '@acorn/protocol/terminal.ts'
import { requestTerminalFocusIntent } from '../registries/clientEvents'
import { latestOnly } from '../lib/latestOnly'

const [sessions, setSessions] = createSignal<TerminalSession[]>([])
export { sessions }

export const refreshSessions = latestOnly(
  async () => (capabilities().terminal ? await readJson<TerminalSession[]>(terminalSessionsRoute) : []),
  (next) => {
    // Notification centre: compare against the last committed snapshot, never a stale request.
    trackSessionEdges(sessions(), next)
    setSessions(next)
  },
)

// Insert a session we just created — create() returns the full session, so callers skip the list
// round trip. The next status broadcast reconciles via refreshSessions anyway.
export const addSession = (s: TerminalSession): void => {
  setSessions((prev) => (prev.some((p) => p.id === s.id) ? prev : [...prev, s]))
}

// Pull once then track main-process idle/exit broadcasts. Returns an unsubscribe; a noop when the
// terminal engine is absent (web build), so consumers naturally show nothing.
export function initSessions(): () => void {
  if (!capabilities().terminal) return () => {}
  void refreshSessions()
  return wsOnStatus(() => void refreshSessions())
}

// Which terminal tab was last viewed, per task (session-only, like isTerminalOpen). Lets the drawer
// reopen on the same tab after a task/workspace switch instead of snapping back to the first.
const activeByTask = new Map<string, string>()
export const activeTerminal = (taskId: string): string | undefined => activeByTask.get(taskId)
export const rememberActiveTerminal = (taskId: string, sessionId: string): void => {
  activeByTask.set(taskId, sessionId)
}
export const evictActiveTerminal = (taskId: string): void => {
  activeByTask.delete(taskId)
}

// Drop everything on a node switch. Terminal sessions are keyed by an opaque node-minted id and the
// rail, the topbar badge and both archive/quit concerns read this list — so node A's running sessions
// were being counted against node B's tasks, up to and including blocking an archive with "2 active
// sessions" that belong to another machine. `initSessions` refetches immediately for the new node, which
// is why clearing is right here where keying by node would be right for a durable preference.
export function clearSessions(): void {
  setSessions([])
  activeByTask.clear()
}

export const requestTerminalFocus = (taskId: string, sessionId: string): void => requestTerminalFocusIntent(taskId, sessionId)

// Target-picker data for sendToAgent (docs/panes.md): the task's running agent sessions,
// most-recent first (the default target), each with its idle dot.
export function agentSessionsFor(taskId: string | null): TerminalSession[] {
  if (!taskId) return []
  return sessions()
    .filter((s) => s.kind === 'agent' && s.status === 'running' && s.taskId === taskId)
    .sort((a, b) => b.createdAt - a.createdAt)
}

// Agents actively working in a task (docs/workspaces-and-tasks.md). "Working" = a running agent that
// isn't idle. Keys off taskId, not the URL — the rail's per-task spinner and the topbar
// badge both read this.
export function workingCountFor(taskId: string | null): number {
  if (!taskId) return 0
  return sessions().filter(
    (s) => s.kind === 'agent' && s.status === 'running' && !s.idle && s.taskId === taskId,
  ).length
}
