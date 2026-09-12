// "Which agents are running in this task": platform state, not terminal-drawer internals. The
// notification edge tracker, the archive and quit concerns, the send-to-agent pickers and the agents
// plugin's rail marker all read it, so it lives in core. One status subscription, one session list.
//
// What it deliberately does not hold is a judgement about what those sessions mean. "This task has an
// agent working" is the agents plugin's sentence, and it says it next to its own managed sessions
// (plugins/agents/src/client/railMarkerContribution.ts).
//
// `hasHostCapability({ plugin: 'terminal' })` is the same probe taskBridge() and terminalApi() use (pinned by
// ./taskBridge.test.ts), so off-desktop this is an empty list and no subscription.
import { createSignal } from 'solid-js'
import { hasHostCapability } from '../../infra/node/hostCapabilities'
import { activeNodeId } from '../../infra/node/activeNode'
import { readJson } from '../../infra/node/apiClient'
import { wsOnNodeEvent } from '../../infra/node/wsClient'
import { fromTerminalSession } from '../notifications/attention'
import { observeAttention } from '../notifications/deliver'
import type { TerminalSession } from '@acorn/protocol/terminal.ts'

// plugins/terminal owns these paths (plugins/terminal/src/contract/routes.ts). They are duplicated
// here as literals because client-core is a shared library and may not import a plugin, which the
// arch suite enforces. Two duplicated strings beat inventing a capability seam for a GET.
const terminalSessionsRoute = '/v2/p/terminal/sessions'
import { requestTerminalFocusIntent } from '../../host/registries/commands/clientEvents'
import { latestOnly } from '../../kit/lib/latestOnly'
import { onScopeEvicted } from '../../host/registries/shell/scopeEviction'

const [sessions, setSessions] = createSignal<TerminalSession[]>([])
export { sessions }

export const refreshSessions = latestOnly(
  async () => (hasHostCapability({ plugin: 'terminal' }) ? await readJson<TerminalSession[]>(terminalSessionsRoute) : []),
  (next) => {
    // Notification centre: the gate keeps its own view of where each session was, so a stale request
    // that lost the race never contributes an edge (notifications/deliver.ts).
    observeAttention(next.flatMap((s) => fromTerminalSession(s, activeNodeId() ?? '') ?? []))
    setSessions(next)
  },
)

// Insert a session we just created: create() returns the full session, so callers skip the list
// round trip. The next status broadcast reconciles via refreshSessions anyway.
export const addSession = (s: TerminalSession): void => {
  setSessions((prev) => (prev.some((p) => p.id === s.id) ? prev : [...prev, s]))
}

// Pull once then track main-process idle/exit broadcasts. Returns an unsubscribe; a noop when the
// terminal engine is absent (web build), so consumers naturally show nothing.
export function initSessions(): () => void {
  if (!hasHostCapability({ plugin: 'terminal' })) return () => {}
  // Caught, because every host now mounts this in front of its node
  // (docs/performance.md § Every host draws first): the first pull lands while the
  // node may still be booting, and an uncaught rejection is a crash under Node's default policy. The
  // terminal client made it visible — OpenTUI answers one by drawing its debug console over the shell.
  // A list that could not be read is an empty list, which is what the next status broadcast fixes.
  const pull = (): void => {
    void refreshSessions().catch(() => {})
  }
  pull()
  // `terminal:sessions-changed`, which is the half of the old `term:status` ping this list actually
  // wanted. The other five subscribers to that ping were paying for this one's edges
  // (docs/performance.md § 2026-09-03 — phase 5).
  return wsOnNodeEvent('terminal:sessions-changed', pull)
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

// Drop everything on a node switch. Sessions are keyed by an opaque node-minted id, so node A's
// running sessions were counted against node B's tasks, once blocking an archive with "2 active
// sessions" that belonged to another machine. `initSessions` refetches for the new node, which is
// why clearing beats keying by node here.
export function clearSessions(): void {
  setSessions([])
  activeByTask.clear()
}

export const requestTerminalFocus = (taskId: string, sessionId: string): void => requestTerminalFocusIntent(taskId, sessionId)

// Target-picker data for sendToAgent: the task's running agent sessions, most-recent first (the
// default target), each with its idle dot.
export function agentSessionsFor(taskId: string | null): TerminalSession[] {
  if (!taskId) return []
  return sessions()
    .filter((s) => s.kind === 'agent' && s.status === 'running' && s.taskId === taskId)
    .sort((a, b) => b.createdAt - a.createdAt)
}

// Registered here rather than in the shell's evictor file, so this signal and the thing that clears
// it are one edit apart (registries/scopeEviction.ts).
onScopeEvicted((e) => {
  if (e.scope === 'task') evictActiveTerminal(e.taskId)
  else if (e.scope === 'node-switched') clearSessions()
})
