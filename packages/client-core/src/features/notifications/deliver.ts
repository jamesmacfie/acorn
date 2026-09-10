// The one gate every agent notice goes through (docs/notifications.md § The gate).
//
// Two rules, and everything else hangs off them. An edge is held for a second and re-checked, so a
// permission that policy auto-answers and a turn that a queued message immediately follows never
// reach anybody. An edge you watched happen — window focused, its task on screen — still lands in
// the bell, already read, and fires no channel: the history is complete and the pill does not move.
//
// Channels beyond the bell row are sinks. Phase 1 registers none; sound, the system notification and
// the terminal's OSC sequences each add one.
import { clientEvents } from '../../host/registries/commands/clientEvents'
import { noticeKindContribution } from '../../host/registries/rail/notices'
import { pluginRowTarget } from '../../host/plugins/rowTargets'
import { onScopeEvicted } from '../../host/registries/shell/scopeEviction'
import { showNotification } from '../../infra/platform'
import { wsOnNotice } from '../../infra/node/wsClient'
import { emitEvent } from '../../infra/telemetry/emitter'
import { activeTaskId } from '../tasks/tasks'
import { edgesBetween, snapshotKey, type Edge, type Snapshot } from './attention'
import { dropNoticesForTask, pushNotice, type Notice } from './notifications'
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
  // The kind and whether it landed already read, and nothing else. The title is the one field on a
  // notice that can carry a person's own words, and a record never quotes the work it describes
  // (docs/telemetry.md § What never leaves the machine).
  emitEvent('core', 'notice.delivered', { seam: 'notice.delivered', 'notice.kind': notice.kind, 'notice.seen': seen })
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

/** Node-pushed notices: a workflow gate, a run finishing, a plugin asking to be installed, a memory
 *  proposal waiting for review. They come through the same gate an agent edge does, so one raised on
 *  the task you are watching lands read and silent.
 *
 *  Three ways a row learns where it goes, in order (docs/notifications.md § What a row points at):
 *
 *  1. The `target` the raiser passed. Every compiled plugin uses this.
 *  2. The `runId` shorthand, for a node built before `target` existed. A client and the node it talks
 *     to are separately installed, so a remote node can be older than the window in front of you.
 *  3. The raising plugin's own surface, for the loaded tier, which is not allowed to name a target
 *     (host/plugins/rowTargets.ts).
 *
 *  Core's own notices — the trust prompt, the install request — name no plugin and no target. They
 *  carry an `action` instead, which the bell answers by opening a dialog rather than navigating. */
export function initWorkflowNotices(): () => void {
  return wsOnNotice((n) => {
    const actionDetail = n.action === 'review-config' ? 'Review & trust' : n.action === 'review-plugin-request' ? 'Review the request' : undefined
    const target = n.target
      ?? (n.runId ? { kind: 'workflow-run', resourceId: n.runId, ...(n.stepId ? { subresourceId: n.stepId } : {}) } : undefined)
      ?? (n.pluginId ? pluginRowTarget(n.pluginId) : undefined)
    deliverNotice({
      // `''` for a notice that is about the node rather than a task: a plugin whose connection
      // expired, a proposal whose task has been archived. The ring keeps `taskId` required and no real
      // id is empty, so every per-task filter in it already treats this as "no task"; the bell skips
      // the task jump on it.
      taskId: n.taskId ?? '',
      kind: n.kind ?? 'plugin',
      title: n.title,
      detail: n.detail ?? actionDetail,
      action: n.action,
      at: Date.now(),
      target,
    })
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
  // `toast` is the kind's own answer to "may this reach the desktop", and until now nothing read it:
  // every kind declared one, three of them declared `false` with a comment saying why, and the banner
  // fired anyway. So `background-error` and `disk-unencrypted` stop banner-ing, which is what those
  // comments always said they did — a standing condition and a swallowed error belong in the bell.
  //
  // An unregistered kind resolves to `plugin`, which is `false`. That is the safe default and the one
  // the tier rule leans on: a loaded plugin's notice is forced to that kind precisely so third-party
  // code cannot put text on the owner's desktop (node-core server/pluginHost/context.ts).
  if (!(noticeKindContribution(notice.kind)?.toast ?? false)) return
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

// A notice points at a task, so an archived task's notices point nowhere. Wired here rather than in
// the ring, which knows nothing about the event bus, and next to the eviction above because both
// answer the same question: what does this client forget when the thing it was about goes away.
//
// Only what this client watched being archived. A task archived from another device is still in the
// ring at the next boot, because notices rehydrate from a prefs blob that nobody re-checks. The row
// is stale rather than wrong, and re-checking it would mean asking the node about 50 task ids at boot.
clientEvents.on('runtime:task-archived', ({ taskId }) => dropNoticesForTask(taskId))
