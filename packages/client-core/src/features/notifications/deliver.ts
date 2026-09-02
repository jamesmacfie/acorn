// The one gate every agent notice goes through (docs/notifications.md § The gate).
//
// Two rules, and everything else hangs off them. An edge is held for a second and re-checked, so a
// permission that policy auto-answers and a turn that a queued message immediately follows never
// reach anybody. An edge you watched happen — window focused, its task on screen — still lands in
// the bell, already read, and fires no channel: the history is complete and the pill does not move.
//
// Channels beyond the bell row are sinks. Phase 1 registers none; sound, the system notification and
// the terminal's OSC sequences each add one.
import { onScopeEvicted } from '../../host/registries/shell/scopeEviction'
import { showNotification } from '../../infra/platform'
import { wsOnNotice } from '../../infra/node/wsClient'
import { activeTaskId } from '../tasks/tasks'
import { edgesBetween, snapshotKey, type Edge, type Snapshot } from './attention'
import { pushNotice, type Notice } from './notifications'
import { readNotificationSettings, type NotificationSettings } from './settings'

export type DeliveryContext = {
  focused(): boolean
  activeTaskId(): string | null
  settings(): NotificationSettings
  now(): number
}

// A host that knows whether it is on screen and is not a document says so here. The terminal client
// installs its DEC 1004 state (apps/tui/src/main.tsx); nothing else calls this, and a host that does
// not falls back to the page's own answer.
let hostFocused: (() => boolean) | null = null
export const setHostFocused = (answer: (() => boolean) | null): void => { hostFocused = answer }

export const defaultDeliveryContext: DeliveryContext = {
  // Unknown counts as focused, which is the quiet answer: a host that cannot say whether it is on
  // screen should not be waking anybody up.
  focused: () => hostFocused?.() ?? (typeof document === 'undefined' ? true : document.hasFocus()),
  activeTaskId: () => activeTaskId(),
  settings: () => readNotificationSettings(),
  now: () => Date.now(),
}

export const HOLD_MS = 1000

export type NoticeSink = (notice: Notice) => void

const sinks: NoticeSink[] = []

export function registerNoticeSink(sink: NoticeSink): () => void {
  sinks.push(sink)
  return () => {
    const at = sinks.indexOf(sink)
    if (at >= 0) sinks.splice(at, 1)
  }
}

// Where each session is now, as the adapters last saw it. The hold has to ask again a second later,
// and a state change that raises no edge — `blocked → working` when you answer — is exactly the one
// that has to cancel a held edge.
const latest = new Map<string, Snapshot>()
const held = new Map<string, ReturnType<typeof setTimeout>>()

const EVENT_OF: Record<Edge['kind'], keyof NotificationSettings['events']> = {
  'agent-needs-input': 'blocked',
  'agent-completed': 'finished',
  'agent-error': 'error',
}

// Read after the hold's re-check, so the snapshot is there. A PTY agent's row opens the terminal
// drawer, a managed one opens the Agent pane; each plugin registers its own handler.
const targetFor = (edge: Edge): Notice['target'] => ({
  kind: latest.get(snapshotKey(edge))?.kind === 'pty' ? 'terminal-session' : 'managed-agent',
  resourceId: edge.sessionId,
})

/** Fold a fresh set of snapshots in, raise whatever edges they make, and keep the map the hold
 *  re-checks against. One call per adapter, per refresh. */
export function observeAttention(next: Snapshot[], context: DeliveryContext = defaultDeliveryContext): void {
  const edges = edgesBetween(latest, next)
  for (const snapshot of next) latest.set(snapshotKey(snapshot), snapshot)
  for (const edge of edges) deliver(edge, context)
}

export function deliver(edge: Edge, context: DeliveryContext = defaultDeliveryContext): void {
  // Off means off: no row either. A silent row that still counted would contradict the switch.
  if (!context.settings().events[EVENT_OF[edge.kind]]) return
  const key = snapshotKey(edge)
  const previous = held.get(key)
  if (previous) clearTimeout(previous)
  held.set(key, setTimeout(() => {
    held.delete(key)
    if (latest.get(key)?.state !== edge.state) return
    deliverNotice({ taskId: edge.taskId, kind: edge.kind, title: edge.title, at: context.now(), target: targetFor(edge) }, context)
  }, HOLD_MS))
}

/** The seen rule and the channels, for a notice that did not come from a session edge: a workflow
 *  gate, a run finishing, a plugin asking to be installed. */
export function deliverNotice(input: Omit<Notice, 'id' | 'read'>, context: DeliveryContext = defaultDeliveryContext): Notice {
  const seen = context.focused() && context.activeTaskId() === input.taskId
  const notice = pushNotice({ ...input, read: seen })
  if (!seen) for (const sink of sinks) sink(notice)
  return notice
}

/** Managed-agent notices carry no prompt-derived title, response, filename, or path. The durable
 *  notice target provides exact navigation without leaking sensitive content to the OS. */
export function pushManagedAgentNotice(input: {
  taskId: string
  sessionId: string
  requestId?: string
  kind: Edge['kind']
  title: string
}): Notice {
  return deliverNotice({
    taskId: input.taskId,
    kind: input.kind,
    title: input.title,
    at: Date.now(),
    target: { kind: 'managed-agent', resourceId: input.sessionId, subresourceId: input.requestId },
  })
}

/** Workflow notices (docs/workflows.md § Routes and UI). Main broadcasts gate and run-done events
 *  over `/v2/events`, and they come through the same gate an agent edge does, so a run that finishes
 *  on the task you are watching lands read and silent. */
export function initWorkflowNotices(): () => void {
  return wsOnNotice((n) => {
    const detail = n.action === 'review-config' ? 'Review & trust' : n.action === 'review-plugin-request' ? 'Review the request' : undefined
    deliverNotice({ taskId: n.taskId, kind: n.kind, title: n.title, detail, action: n.action, at: Date.now() })
  })
}

/** The system channel: an OS banner for every unseen notice the settings allow, through the
 *  platform seam's `notify` group where a shell installed one and the page's own `Notification`
 *  otherwise (infra/platform/index.ts).
 *
 *  The body is the notice's `detail` and nothing else. A title is already free of prompt text,
 *  responses, filenames and paths (`pushManagedAgentNotice`), and the notification centre keeps what
 *  it is shown: an OS banner is the one surface where "what happened" must not become "what it
 *  said". */
export function initSystemNotices(): () => void {
  return registerNoticeSink(systemSink)
}

/** Exported for the test. Sinks only ever see an unseen notice, so the seen rule is already kept. */
export function systemSink(notice: Notice): void {
  if (!readNotificationSettings().system) return
  void showNotification({ title: notice.title, body: notice.detail, tag: notice.id })
}

/** Node switch, or a test starting clean. Snapshots and held edges are judgements about one node's
 *  session ids, and two nodes may hold the same id. */
export function resetDelivery(): void {
  for (const timer of held.values()) clearTimeout(timer)
  held.clear()
  latest.clear()
}

onScopeEvicted((e) => {
  if (e.scope === 'node-switched') resetDelivery()
})
