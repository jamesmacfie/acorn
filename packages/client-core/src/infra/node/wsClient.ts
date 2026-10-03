// The renderer end of the one authenticated stream socket. This file does not own the socket: the
// desktop main's connection broker does, because the device token rides the upgrade request's headers
// and a browser cannot set those (docs/architecture/node-api.md § The platform seam).
//
// What stays here is node filtering, envelope dispatch and reconnect signaling. The broker owns
// the URL, socket lifecycle, outbox and reconnect backoff. Stream owners manage their payloads.
//
// Dispatch is a prefix registry (wsChannels.ts). Core handles the generic `term:status` chrome
// invalidation and workflow notices; Terminal registers the PTY `term:` payload handler.
import type { AgentSessionChangedEvent, ConnectionChangedEvent, HeadChangedEvent, ProjectChangedEvent, RunTargetChangedEvent, TaskChangedEvent, WorkspaceChangedEvent, WorkspaceProjectsChangedEvent, WorktreeStatusChangedEvent } from '@acorn/protocol/nodeEvents.ts'
import type { NoticeFrame } from '@acorn/protocol/notices.ts'
import { type WsClientFrame, type WsServerFrame, type WsSendOptions } from '@acorn/protocol/ws.ts'
import { nodeTransport } from '../platform'
import { measure } from '../telemetry/emitter'
import { activeNodeId } from './activeNode'
import { registerWsChannel, routeWsFrame, wsReattachFrames, wsSubscriptionIntent } from './wsChannels'
import { toast } from '../../features/notifications/toast'

// `term:status` carries the id of the plugin whose chrome moved, or nothing when core itself pinged and
// every plugin's descriptors are suspect (node-core/server/notify.ts).
type StatusCb = (pluginId?: string) => void
// The bell-row frame, one shape shared with the node that sends it (@acorn/protocol/notices.ts)
// rather than a hand-written twin here that drifts when a field is added.
//
// The name stays `WorkflowNotice` because it is published through the plugin-api facade, where
// removing a name costs a major bump and this one has no callers to gain from the rename. Nothing
// about the payload is workflows' any more: `kind` is a contributed id rather than the closed union it
// was, and `target` replaced the `runId` pair.
export type WorkflowNotice = NoticeFrame
type NoticeCb = (n: WorkflowNotice) => void
type StepEventCb = (event: { runId: string; stepId: string; event: unknown }) => void
type StepChangedCb = (event: { runId: string; stepId: string; status: string }) => void

const statusSubs = new Set<StatusCb>()
const pluginsSubs = new Set<() => void>()
// Plugin lifecycle is fleet control data. Keep its source before the ordinary active-node stream
// filter, without widening task, terminal, or other application subscriptions.
const fleetPluginsSubs = new Set<(nodeId: string) => void>()
const tasksSubs = new Set<(event: TaskChangedEvent) => void>()
const connectionSubs = new Set<(event: ConnectionChangedEvent) => void>()
// The node events after the first three, keyed by channel. One registry rather than one Set per event,
// because they share a shape: a core-named frame whose fields are the payload
// (@acorn/protocol/nodeEvents.ts).
type NodeEventMap = {
  'head:changed': HeadChangedEvent
  'run:changed': RunTargetChangedEvent
  'agent-session:changed': AgentSessionChangedEvent
  'project:changed': ProjectChangedEvent
  'workspace:changed': WorkspaceChangedEvent
  'workspace-projects:changed': WorkspaceProjectsChangedEvent
  'worktree:status-changed': WorktreeStatusChangedEvent
}
const nodeEventSubs = new Map<keyof NodeEventMap, Set<(event: never) => void>>()
const noticeSubs = new Set<NoticeCb>()
const stepEventSubs = new Set<StepEventCb>()
const stepChangedSubs = new Set<StepChangedCb>()
const reconnectSubs = new Set<() => void>()

type BinaryHandler = (frame: Uint8Array) => void
let binaryHandler: BinaryHandler | null = null

/** The active stream owner receives bytes only after the broker's node filter. */
export function registerWsBinaryHandler(handler: BinaryHandler): { dispose(): void } {
  if (binaryHandler) throw new Error('binary stream handler already registered')
  binaryHandler = handler
  connect()
  return { dispose: () => { if (binaryHandler === handler) binaryHandler = null } }
}

let bridged = false
// Which nodes' sockets have been up at least once. A later transition to online is a reconnect, which
// means re-attach and refetch. The first connect means neither.
//
// Per node, not one flag. A single boolean read a second node's first connect as a reconnect, and
// re-attached every PTY subscription against the active node.
const everOnline = new Set<string>()

// The one send door. A channel owner needs it to attach and detach its own streams, and it is the only
// part of the socket a plugin can reach.
export function wsSend(frame: WsClientFrame, options?: WsSendOptions): void {
  rawSend(frame, activeNodeId(), options)
}

/** Sends cleanup to its captured Node without changing the renderer's event interest. */
export function wsSendToNode(nodeId: string, frame: WsClientFrame, options?: WsSendOptions): void {
  rawSend(frame, nodeId, options)
}

function rawSend(frame: WsClientFrame, nodeId = activeNodeId(), options?: WsSendOptions): void {
  if (!nodeId) return
  connect()
  // No local queue: main holds one, so a frame sent before its socket is open is still delivered.
  const intent = options?.intent ?? wsSubscriptionIntent(frame)
  nodeTransport()?.send(nodeId, frame, intent || options ? { ...options, ...(intent ? { intent } : {}) } : undefined)
}

// Subscribe to the broker's push channels. Idempotent and never torn down, because this module is a
// singleton whose lifetime is the renderer's.
function connect(): void {
  if (bridged) return
  const transport = nodeTransport()
  if (!transport) return
  bridged = true
  transport.interest(activeNodeId())
  transport.onError((_nodeId, error) => toast(error.message, { tone: 'danger' }))

  // The nodeId is a filter, not decoration. Main opens a socket to every paired node and pushes every
  // frame here. Without the filter, node B's output for a colliding stream id feeds node A's reader
  // (docs/architecture/fleet.md § Client state and fleet behavior).
  //
  // Dropping rather than routing works because only the active node's surfaces are subscribed. A
  // fleet-wide live surface would need a nodeId in the subscription key, not a wider filter here.
  transport.onFrame((nodeId, raw) => {
    if (raw && typeof raw === 'object' && (raw as { channel?: unknown }).channel === 'plugins:changed') {
      for (const cb of fleetPluginsSubs) cb(nodeId)
    }
    if (nodeId !== activeNodeId()) return
    dispatch(raw)
  })
  // Binary stream output has the same node filter. Its owner decodes the payload.
  transport.onBytes((nodeId, frame) => {
    if (nodeId !== activeNodeId()) return
    binaryHandler?.(frame)
  })
  transport.onStatus((status) => {
    if (status.state !== 'online') return
    if (status.nodeId === activeNodeId()) transport.interest(status.nodeId)
    if (!everOnline.has(status.nodeId)) {
      everOnline.add(status.nodeId)
      return
    }
    // Every `rawSend` below addresses the active node, and `reconnectSubs` invalidates the active
    // node's cache, so another node's reconnect must not reach either.
    if (status.nodeId !== activeNodeId()) return
    // Re-attach every live subscription. The node treats attach as idempotent per connection, so this
    // re-subscribes each PTY and restores its display snapshot. Each channel owner supplies its own
    // frames (wsChannels.ts).
    for (const frame of wsReattachFrames()) rawSend(frame)
    // Reconnect means refetch (docs/api-reference.md § WebSocket). There is no cursor into history, so
    // the client marks the node's cache stale instead of replaying. The QueryClient lives in the app
    // shell, so this announces rather than performs it.
    reconnectSubs.forEach((cb) => cb())
  })
}

function dispatch(raw: unknown): void {
  if (!raw || typeof raw !== 'object' || typeof (raw as { channel?: unknown }).channel !== 'string') return
  const frame = raw as WsServerFrame
  // A histogram and never a span. Terminal output alone is hundreds of frames a second while an
  // agent is writing, so this is one record every five seconds however hot the socket is
  // (docs/telemetry.md § Hot seams are metrics). Keyed on the prefix, because `term:out` and
  // `plugin:machine-stats:sample` are different questions and one channel per session is not.
  measure('core', `ws.inbound.${frame.channel.split(':')[0]}`, () => {
    // The broker's gap detection strips `seq` before this point. Core reads `channel` and the owner
    // narrows the rest.
    if (frame.channel === 'term:status') {
      const { pluginId } = frame as { pluginId?: unknown }
      statusSubs.forEach((cb) => cb(typeof pluginId === 'string' ? pluginId : undefined))
    } else routeWsFrame(frame)
  })
}

// Core handles only the generic `term:status` chrome invalidation. Terminal registers the PTY
// payload handler for this prefix through the ordinary channel registry.
registerWsChannel('workflow', (frame) => {
  if (frame.channel === 'workflow:notice') return noticeSubs.forEach((cb) => cb(frame.notice as Parameters<NoticeCb>[0]))
  if (frame.channel === 'workflow:step:event') return stepEventSubs.forEach((cb) => cb(frame as unknown as Parameters<StepEventCb>[0]))
  if (frame.channel === 'workflow:step-changed') stepChangedSubs.forEach((cb) => cb(frame as unknown as Parameters<StepChangedCb>[0]))
})

// Core's third prefix (docs/api-reference.md § WebSocket). Content-free like `term:status`, so the
// subscriber re-reads the roster route (plugins/reload.ts).
registerWsChannel('plugins', (frame) => {
  if (frame.channel === 'plugins:changed') pluginsSubs.forEach((cb) => cb())
})

// And its fourth. A task was created, patched, archived, cancelled, or had its links change on the
// node — from this window, from another one, or from an agent (node-core/server/notify.ts). The id is
// preserved for plugin consumers even though the built-in watcher invalidates the whole task list.
registerWsChannel('tasks', (frame) => {
  if (frame.channel !== 'tasks:changed') return
  const { taskId } = frame
  if (typeof taskId !== 'string' && taskId !== null) return
  tasksSubs.forEach((cb) => cb({ taskId }))
})

// And its fifth. A connection was made, rotated, tested, disabled, or demoted to `needs-auth` because
// its credential stopped working (node-core/server/notify.ts). The only core frame with a payload, so it
// is the only one that reads its own fields — narrowed here rather than at each subscriber, because a
// frame off the wire is `Record<string, unknown>` and every consumer would otherwise repeat the check.
registerWsChannel('connection', (frame) => {
  if (frame.channel !== 'connection:changed') return
  const { integrationId, providerId } = frame
  if (typeof integrationId !== 'string' || typeof providerId !== 'string') return
  if (frame.deleted === true) return connectionSubs.forEach((cb) => cb({ integrationId, providerId, deleted: true }))
  if (typeof frame.status !== 'string') return
  connectionSubs.forEach((cb) => cb({ integrationId, providerId, status: frame.status as Extract<ConnectionChangedEvent, { status: unknown }>['status'] }))
})

// The rest of core's payload-carrying catalogue: HEAD moved, a run target started or stopped, an agent
// session reached an edge, a project or workspace projection moved, a terminal session's roster moved,
// or something under a task's worktree changed. Each prefix is the noun before the
// colon, and the frame minus `channel` is the payload. Not narrowed field by field
// like `connection` above: the frame came from this node over the authenticated socket, and a
// subscriber that needs a field checked does it once at the point of use.
for (const prefix of ['head', 'run', 'agent-session', 'project', 'workspace', 'workspace-projects', 'worktree']) {
  registerWsChannel(prefix, (frame) => {
    const { channel, ...event } = frame
    nodeEventSubs.get(channel as keyof NodeEventMap)?.forEach((cb) => cb(event as never))
  })
}


// Core's twelfth, and the only one that is an apology. The node's hub shed invalidation frames because
// this socket was too far behind to take them (node-core/server/transport/wsHub.ts). Nothing says which
// ones, so the remedy is the reconnect remedy: mark what is on screen stale and let it refetch.
registerWsChannel('ws', (frame) => {
  if (frame.channel === 'ws:shed') reconnectSubs.forEach((cb) => cb())
})

// Fires when the node's socket comes back after a drop. The app shell uses it to mark that node's
// queries stale so whatever is on screen refetches.
export function wsOnReconnect(cb: () => void): () => void {
  reconnectSubs.add(cb)
  connect()
  return () => void reconnectSubs.delete(cb)
}

// Announce that the socket should exist. A channel owner calls this when it takes its first
// subscriber, the same way every subscribe helper in this file does.
export const wsConnect = (): void => connect()

// Test seam: this module's singletons outlive a single test otherwise.
export function _resetWsClient(): void {
  bridged = false
  // Not _resetWsChannels(). This module registers its prefixes at import time, so clearing the map
  // leaves the socket mute for every later test in the file.
  everOnline.clear()
  binaryHandler = null
  statusSubs.clear()
  pluginsSubs.clear()
  fleetPluginsSubs.clear()
  tasksSubs.clear()
  connectionSubs.clear()
  nodeEventSubs.clear()
  noticeSubs.clear()
  stepEventSubs.clear()
  reconnectSubs.clear()
}

// "Re-read a plugin's chrome descriptors." One subscriber, `host/chrome/chromeData.ts`, and the
// argument is what keeps it from being a fan-out: a plugin's own ping refreshes that plugin's rows and
// nobody else's (docs/plugins.md § Hearing a core event).
export function wsOnStatus(cb: StatusCb): () => void {
  statusSubs.add(cb)
  connect()
  return () => void statusSubs.delete(cb)
}

// A reload swapped a plugin's node half (docs/plugins.md § The dev loop). A subscriber rather than a
// direct call, because plugins/chrome imports this module and the reverse edge would be a cycle.
export function wsOnPluginsChanged(cb: () => void): () => void {
  pluginsSubs.add(cb)
  connect()
  return () => void pluginsSubs.delete(cb)
}

/** A content-free plugin change from any paired node, carrying the broker's authenticated source id. */
export function wsOnFleetPluginsChanged(cb: (nodeId: string) => void): () => void {
  fleetPluginsSubs.add(cb)
  connect()
  return () => void fleetPluginsSubs.delete(cb)
}

// The node's task list moved. Same subscriber shape and the same reason: tasks/mutations.ts would be a
// cycle if this module reached into it.
export function wsOnTasksChanged(cb: (event: TaskChangedEvent) => void): () => void {
  tasksSubs.add(cb)
  connect()
  return () => void tasksSubs.delete(cb)
}

// A connection's status moved on the node. Same subscriber shape as the two above.
export function wsOnConnectionChanged(cb: (event: ConnectionChangedEvent) => void): () => void {
  connectionSubs.add(cb)
  connect()
  return () => void connectionSubs.delete(cb)
}

// Hear one of the payload-carrying node events (the registry above). Same subscriber shape as the
// three named ones.
export function wsOnNodeEvent<K extends keyof NodeEventMap>(channel: K, cb: (event: NodeEventMap[K]) => void): () => void {
  const subs = nodeEventSubs.get(channel) ?? new Set()
  subs.add(cb as (event: never) => void)
  nodeEventSubs.set(channel, subs)
  connect()
  return () => void subs.delete(cb as (event: never) => void)
}

export function wsOnNotice(cb: NoticeCb): () => void {
  noticeSubs.add(cb)
  connect()
  return () => void noticeSubs.delete(cb)
}

export function wsOnWorkflowStepEvent(cb: StepEventCb): () => void {
  stepEventSubs.add(cb)
  connect()
  return () => void stepEventSubs.delete(cb)
}

export function wsOnWorkflowStepChanged(cb: StepChangedCb): () => void {
  stepChangedSubs.add(cb)
  connect()
  return () => void stepChangedSubs.delete(cb)
}
