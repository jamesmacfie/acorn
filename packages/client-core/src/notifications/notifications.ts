// Notification centre (docs/terminal-and-agents.md): a bounded in-memory ring of agent-event notices, mirrored to
// a prefs blob so the last ~50 survive a reload — ephemeral app state, not a table (the durable
// truth is the session/task). Signals-only, like sessions.ts. Edge detection is pure (detectEdges),
// fed by the sessions store on every refresh; OS toasts are focus-gated + cooldown/deduped here
// (the main process no longer fires them).
import { createSignal } from 'solid-js'
import type { TerminalSession } from '@acorn/protocol/terminal.ts'
import { wsOnNotice } from '../wsClient'
import { activeNodeId } from '../node/activeNode'
import { homeNodeId } from '../node/fleet'
import { noticeKindContribution } from '../registries/notices'

export type NoticeKind = string
export type NoticeTarget = {
  kind: string
  resourceId: string
  subresourceId?: string
}

export type Notice = {
  id: string
  taskId: string
  kind: NoticeKind
  title: string // "claude finished"
  detail?: string
  at: number
  read: boolean
  action?: 'review-config'
  target?: NoticeTarget
  // Which node the notice is about. Stamped by `pushNotice` from the active node rather than passed by
  // each of the six call sites: every notice originates from a frame or a session list belonging to
  // whichever node the client is currently talking to (wsClient.ts now drops frames from any other), so
  // the caller has no extra information to add and six chances to forget.
  //
  // A nodeId rather than clearing the ring on a switch. Notices are persisted and rehydrated once at
  // boot, so clearing would empty the bell permanently after the first node switch; filtering keeps both
  // nodes' history and is what ui.md § Prompts and notifications asks for ("grouped per node").
  // `undefined` for a notice restored from a pre-Phase-4 blob, which reads as "belongs to the home node".
  nodeId?: string
}

export const NOTICE_CAP = 50

const [notices, setNotices] = createSignal<Notice[]>([])
export { notices }

export const capNotices = (list: Notice[]): Notice[] => list.slice(0, NOTICE_CAP)

let counter = 0
const noticeId = (at: number) => `n${at}-${counter++}`
const targetHandlers = new Map<string, (taskId: string, target: NoticeTarget) => void>()

export function registerNoticeTargetHandler(
  kind: string,
  handler: (taskId: string, target: NoticeTarget) => void,
): () => void {
  targetHandlers.set(kind, handler)
  return () => {
    if (targetHandlers.get(kind) === handler) targetHandlers.delete(kind)
  }
}

export function openNoticeTarget(notice: Notice): void {
  if (notice.target) openTarget(notice.taskId, notice.target)
}

// The same dispatch for an ATTENTION item, which carries the identical target shape but is not a Notice
// (registries/attention.ts explains why they are separate types). Exported rather than duplicating the
// handler-table lookup in the inbox: one table, one place that knows how to open a target.
export function openTarget(taskId: string, target: NoticeTarget): void {
  targetHandlers.get(target.kind)?.(taskId, target)
}

export function pushNotice(n: Omit<Notice, 'id' | 'read'>): Notice {
  // The stamp goes AFTER the spread, with the caller's value preferred only when it is actually set.
  // `Omit<Notice,'id'|'read'>` still includes an optional `nodeId`, so a caller passing `nodeId: undefined`
  // used to clear the stamp — and an unstamped notice reads as the home node's, i.e. someone else's.
  const notice: Notice = { ...n, nodeId: n.nodeId ?? activeNodeId() ?? undefined, id: noticeId(n.at), read: false }
  setNotices((prev) => capNotices([notice, ...prev]))
  return notice
}

// Notices for the node the client is looking at. A notice with no nodeId is a pre-Phase-4 restored entry
// and belongs to the home node, which is where the prefs blob it came from lives.
export const noticesForActiveNode = (): Notice[] => {
  const active = activeNodeId()
  if (!active) return notices()
  const home = homeNodeId()
  return notices().filter((n) => (n.nodeId ?? home ?? active) === active)
}

// Counts follow the same filter. They drive the bell pill and the rail's per-task marker, and a count
// that included another node's tasks pointed at rows the user cannot see from here.
export const unreadCount = (): number => noticesForActiveNode().filter((n) => !n.read).length
export const unreadForTask = (taskId: string): number =>
  noticesForActiveNode().filter((n) => !n.read && n.taskId === taskId).length

export function markRead(id: string): void {
  setNotices((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
}
// "Mark all read" from the bell means the list the bell is SHOWING. Marking another node's notices read
// from a popover that never displayed them would quietly destroy the only signal that they existed.
export function markAllRead(): void {
  const visible = new Set(noticesForActiveNode().map((n) => n.id))
  setNotices((prev) =>
    prev.some((n) => !n.read && visible.has(n.id)) ? prev.map((n) => (visible.has(n.id) ? { ...n, read: true } : n)) : prev,
  )
}
// Viewing a task acknowledges its notices — the ACTIVE node's, matching `unreadForTask` and `markAllRead`.
// Without the filter this marked another node's notice about a task with the same id read, so the badge on
// that node silently lost the only signal that it existed. Two nodes holding one task UUID is the case
// architecture.md § Fleet semantics says must never collide.
export function markTaskRead(taskId: string): void {
  const visible = new Set(noticesForActiveNode().filter((n) => n.taskId === taskId).map((n) => n.id))
  setNotices((prev) =>
    prev.some((n) => !n.read && visible.has(n.id)) ? prev.map((n) => (visible.has(n.id) ? { ...n, read: true } : n)) : prev,
  )
}

// Hydrate from the persisted prefs blob without clobbering notices raised pre-hydration.
export function hydrateNotices(json: string | undefined): void {
  if (!json) return
  try {
    const raw = JSON.parse(json) as unknown
    if (!Array.isArray(raw)) return
    const restored = raw.filter(
      (n): n is Notice => !!n && typeof n === 'object' && typeof (n as Notice).id === 'string' && typeof (n as Notice).taskId === 'string' && typeof (n as Notice).title === 'string',
    )
    setNotices((prev) => capNotices([...prev, ...restored.filter((r) => !prev.some((p) => p.id === r.id))]))
  } catch {
    // malformed blob → start fresh
  }
}
export function hydrateNoticeValues(restored: Notice[]): void {
  setNotices((prev) => capNotices([...prev, ...restored.filter((candidate) => !prev.some((notice) => notice.id === candidate.id))]))
}
export const serializeNotices = (): string => JSON.stringify(notices())

// Test seam: the ring is a module singleton, so cases in one file otherwise inherit each other's
// notices — which matters now that visibility depends on a node stamp and an unstamped leftover reads as
// "belongs to whatever node is active".
export function _resetNotices(): void {
  setNotices([])
}

// --- Pure edge detection (docs/terminal-and-agents.md): compare consecutive session snapshots. Edges are
// tracked unconditionally (suppression only affects the OS toast) so the NEXT transition is right.
type SessionEdgeState = Pick<TerminalSession, 'id' | 'taskId' | 'title' | 'kind' | 'status' | 'idle' | 'agentState' | 'exitCode'>

export function detectEdges(prev: SessionEdgeState[], next: SessionEdgeState[], at: number): Omit<Notice, 'id' | 'read'>[] {
  const before = new Map(prev.map((s) => [s.id, s]))
  const out: Omit<Notice, 'id' | 'read'>[] = []
  for (const s of next) {
    const p = before.get(s.id)
    if (!p) continue // brand-new session — no edge yet
    if (s.kind === 'agent' && p.status === 'running' && !p.idle && s.status === 'running' && s.idle && s.agentState !== 'blocked') {
      out.push({ taskId: s.taskId, kind: 'finished', title: `${s.title} finished`, detail: 'agent went idle', at })
    }
    if (s.agentState === 'blocked' && p.agentState !== 'blocked') {
      out.push({ taskId: s.taskId, kind: 'needs-input', title: `${s.title} needs input`, at })
    }
    if (p.status === 'running' && s.status === 'exited') {
      const failed = s.exitCode != null && s.exitCode !== 0
      out.push({
        taskId: s.taskId,
        kind: failed ? 'error' : 'exited',
        title: `${s.title} exited${failed ? ` (code ${s.exitCode})` : ''}`,
        at,
      })
    }
  }
  return out
}

// --- OS-toast gating (docs/terminal-and-agents.md): focused window → bell only; plus a per-(task,kind)
// cooldown so a chatty agent can't spam. Pure — state is passed in.
export const TOAST_COOLDOWN_MS = 30_000

export function shouldToast(
  notice: Pick<Notice, 'taskId' | 'kind' | 'at'>,
  opts: { focused: boolean; lastToastAt: Map<string, number>; cooldownMs?: number },
): boolean {
  if (noticeKindContribution(notice.kind)?.toast === false) return false
  if (opts.focused) return false
  const key = `${notice.taskId}:${notice.kind}`
  const last = opts.lastToastAt.get(key)
  const cooldown = opts.cooldownMs ?? TOAST_COOLDOWN_MS
  if (last != null && notice.at - last < cooldown) return false
  opts.lastToastAt.set(key, notice.at)
  return true
}

export function pushBackgroundError(taskId: string, title: string, detail?: string): Notice {
  return pushNotice({ taskId, kind: 'background-error', title, detail, at: Date.now() })
}

// Workflow notices (docs/workflows.md, docs/terminal-and-agents.md): main broadcasts gate/run-done events over the stream
// WebSocket (the WebSocket transport); they land in the same bell + toast gate. Returns unsubscribe.
export function initWorkflowNotices(): () => void {
  return wsOnNotice((n) => {
    const at = Date.now()
    pushNotice({ taskId: n.taskId, kind: n.kind, title: n.title, detail: n.action === 'review-config' ? 'Review & trust' : undefined, action: n.action, at })
    if (typeof Notification !== 'undefined' && shouldToast({ taskId: n.taskId, kind: n.kind, at }, { focused: document.hasFocus(), lastToastAt })) {
      try {
        new Notification(n.title)
      } catch {
        // never break the bell
      }
    }
  })
}

// --- Wiring: called by sessions.ts on every refresh with the previous + new snapshot.
const lastToastAt = new Map<string, number>()

// Managed-agent notices deliberately carry no prompt-derived title, response, filename, or path.
// The durable notice target provides exact navigation without leaking sensitive content to the OS.
export function pushManagedAgentNotice(input: {
  taskId: string
  sessionId: string
  requestId?: string
  kind: 'agent-completed' | 'agent-needs-input' | 'agent-error'
  title: string
}): Notice {
  const at = Date.now()
  const notice = pushNotice({
    taskId: input.taskId,
    kind: input.kind,
    title: input.title,
    at,
    target: {
      kind: 'managed-agent',
      resourceId: input.sessionId,
      subresourceId: input.requestId,
    },
  })
  if (
    typeof Notification !== 'undefined'
    && shouldToast(notice, { focused: document.hasFocus(), lastToastAt })
  ) {
    try {
      new Notification(input.title)
    } catch {
      // Notification permission/support issues never break durable in-app attention.
    }
  }
  return notice
}

export function trackSessionEdges(prev: TerminalSession[], next: TerminalSession[]): void {
  const at = Date.now()
  for (const edge of detectEdges(prev, next, at)) {
    pushNotice(edge)
    if (typeof Notification !== 'undefined' && shouldToast(edge, { focused: document.hasFocus(), lastToastAt })) {
      try {
        new Notification(edge.title, { body: edge.detail })
      } catch {
        // Notification permission/support issues never break the bell
      }
    }
  }
}
