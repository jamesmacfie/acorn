// Notification centre (docs/next 05): a bounded in-memory ring of agent-event notices, mirrored to
// a prefs blob so the last ~50 survive a reload — ephemeral app state, not a table (the durable
// truth is the session/task). Signals-only, like sessions.ts. Edge detection is pure (detectEdges),
// fed by the sessions store on every refresh; OS toasts are focus-gated + cooldown/deduped here
// (the main process no longer fires them).
import { createSignal } from 'solid-js'
import type { TerminalSession } from '../../../shared/terminal'

export type NoticeKind = 'finished' | 'needs-input' | 'exited' | 'error' | 'gate' | 'run-done'

export type Notice = {
  id: string
  taskId: string
  kind: NoticeKind
  title: string // "claude finished"
  detail?: string
  at: number
  read: boolean
}

export const NOTICE_CAP = 50

const [notices, setNotices] = createSignal<Notice[]>([])
export { notices }

export const capNotices = (list: Notice[]): Notice[] => list.slice(0, NOTICE_CAP)

let counter = 0
const noticeId = (at: number) => `n${at}-${counter++}`

export function pushNotice(n: Omit<Notice, 'id' | 'read'>): Notice {
  const notice: Notice = { ...n, id: noticeId(n.at), read: false }
  setNotices((prev) => capNotices([notice, ...prev]))
  return notice
}

export const unreadCount = (): number => notices().filter((n) => !n.read).length
export const unreadForTask = (taskId: string): number => notices().filter((n) => !n.read && n.taskId === taskId).length

export function markRead(id: string): void {
  setNotices((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
}
export function markAllRead(): void {
  setNotices((prev) => (prev.some((n) => !n.read) ? prev.map((n) => ({ ...n, read: true })) : prev))
}
// Viewing a task acknowledges its notices (verne's needsAcknowledgement).
export function markTaskRead(taskId: string): void {
  setNotices((prev) => (prev.some((n) => !n.read && n.taskId === taskId) ? prev.map((n) => (n.taskId === taskId ? { ...n, read: true } : n)) : prev))
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
export const serializeNotices = (): string => JSON.stringify(notices())

// --- Pure edge detection (docs/next 05): compare consecutive session snapshots. Edges are
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

// --- OS-toast gating (docs/next 05 P2): focused window → bell only; plus a per-(task,kind)
// cooldown so a chatty agent can't spam. Pure — state is passed in.
export const TOAST_COOLDOWN_MS = 30_000

export function shouldToast(
  notice: Pick<Notice, 'taskId' | 'kind' | 'at'>,
  opts: { focused: boolean; lastToastAt: Map<string, number>; cooldownMs?: number },
): boolean {
  if (opts.focused) return false
  const key = `${notice.taskId}:${notice.kind}`
  const last = opts.lastToastAt.get(key)
  const cooldown = opts.cooldownMs ?? TOAST_COOLDOWN_MS
  if (last != null && notice.at - last < cooldown) return false
  opts.lastToastAt.set(key, notice.at)
  return true
}

// --- Wiring: called by sessions.ts on every refresh with the previous + new snapshot.
const lastToastAt = new Map<string, number>()

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
