// Notification centre: a bounded in-memory ring of agent-event notices, mirrored to a prefs blob so
// the last 50 survive a reload. Ephemeral app state, not a table. The durable truth is the session or
// task.
//
// This file is the ring and nothing else. What is worth a notice is attention.ts, and when it lands
// and which channels it wakes is deliver.ts.
import { createSignal } from 'solid-js'
import { activeNodeId } from '../../infra/node/activeNode'
import { homeNodeId } from '../../infra/node/fleet'

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
  action?: 'review-config' | 'review-plugin-request'
  target?: NoticeTarget
  // Which node the notice is about. Stamped by `pushNotice` from the active node rather than passed
  // by each call site, because every notice comes from a frame or session list belonging to the node
  // the client is talking to (wsClient.ts drops the rest).
  //
  // A nodeId rather than clearing the ring on a switch. Notices are persisted and rehydrated at boot,
  // so clearing empties the bell permanently after the first switch. `undefined` means the home node.
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

// The same dispatch for an attention item, which carries the identical target shape but is not a
// Notice (registries/attention.ts). Exported so the inbox does not repeat the handler-table lookup.
export function openTarget(taskId: string, target: NoticeTarget): void {
  targetHandlers.get(target.kind)?.(taskId, target)
}

// `read` is how an edge you watched happen still gets a row without moving the pill
// (deliver.ts § the seen rule). Everything else pushes unread.
export function pushNotice(n: Omit<Notice, 'id' | 'read'> & { read?: boolean }): Notice {
  const notice: Notice = { ...n, nodeId: n.nodeId ?? activeNodeId() ?? undefined, id: noticeId(n.at), read: n.read ?? false }
  setNotices((prev) => capNotices([notice, ...prev]))
  return notice
}

// Notices for the node the client is looking at. A notice with no nodeId belongs to the home node.
export const noticesForActiveNode = (): Notice[] => {
  const active = activeNodeId()
  if (!active) return notices()
  const home = homeNodeId()
  return notices().filter((n) => (n.nodeId ?? home ?? active) === active)
}

// Counts follow the same filter. They drive the bell pill and the rail's per-task marker, and counting
// another node's tasks points at rows the user cannot see from here.
export const unreadCount = (): number => noticesForActiveNode().filter((n) => !n.read).length
export const unreadForTask = (taskId: string): number =>
  noticesForActiveNode().filter((n) => !n.read && n.taskId === taskId).length

export function markRead(id: string): void {
  setNotices((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
}
// "Mark all read" from the bell means the list the bell is showing. Marking another node's notices
// read from a popover that never displayed them destroys the only signal that they existed.
export function markAllRead(): void {
  const visible = new Set(noticesForActiveNode().map((n) => n.id))
  setNotices((prev) =>
    prev.some((n) => !n.read && visible.has(n.id)) ? prev.map((n) => (visible.has(n.id) ? { ...n, read: true } : n)) : prev,
  )
}
// Viewing a task acknowledges its notices on the active node, matching `unreadForTask` and
// `markAllRead`. Without the filter, a task with the same id on another node loses its badge. Two
// nodes holding one task UUID must never collide (docs/architecture-overview.md § Client state and
// fleet behavior).
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

// Test seam: the ring is a module singleton, so cases in one file inherit each other's notices. An
// unstamped leftover reads as "belongs to whatever node is active".
export function _resetNotices(): void {
  setNotices([])
}

export function pushBackgroundError(taskId: string, title: string, detail?: string): Notice {
  return pushNotice({ taskId, kind: 'background-error', title, detail, at: Date.now() })
}
