// The renderer end of the one authenticated stream socket. This file does not own the socket: the
// desktop main's connection broker does, because the device token rides the upgrade request's headers
// and a browser cannot set those (docs/architecture-overview.md § Node API and client flow).
//
// What stays here is the subscription registries, the first-attach/last-detach contract, and the
// re-attach-on-reconnect behaviour. The broker owns the URL, the socket lifecycle, the outbox, and the
// reconnect backoff.
//
// Dispatch is a prefix registry (wsChannels.ts). This file owns `term:` and `workflow:`, because
// `term:` is core transport on both ends and `workflow:notice` feeds core's notification pipeline.
// `docker:` and `agent:` are registered by the plugins that own them.
import type { AgentSessionChangedEvent, ConnectionChangedEvent, HeadChangedEvent, ProjectChangedEvent, RunTargetChangedEvent, WorktreeStatusChangedEvent } from '@acorn/protocol/nodeEvents.ts'
import type { ServerMsg } from '@acorn/protocol/terminal.ts'
import { decodeIdFrame, type WsClientFrame, type WsServerFrame } from '@acorn/protocol/ws.ts'
import { nodeTransport } from '../platform'
import { activeNodeId } from './activeNode'
import { registerWsChannel, routeWsFrame, wsReattachFrames, _resetWsChannels } from './wsChannels'

type OutputCb = (m: ServerMsg) => void
// `term:status` carries the id of the plugin whose chrome moved, or nothing when core itself pinged and
// every plugin's descriptors are suspect (node-core/server/notify.ts).
type StatusCb = (pluginId?: string) => void
// Exported so subscribers outside this package import it rather than keeping a hand-written twin that
// drifts when a kind is added.
export type WorkflowNotice = {
  taskId: string
  kind: 'gate' | 'run-done' | 'repo-config-trust' | 'plugin-request'
  title: string
  action?: 'review-config' | 'review-plugin-request'
}
type NoticeCb = (n: WorkflowNotice) => void
type StepEventCb = (event: { runId: string; stepId: string; event: unknown }) => void

const outputSubs = new Map<string, Set<OutputCb>>() // sessionId → local subscribers
const statusSubs = new Set<StatusCb>()
const pluginsSubs = new Set<() => void>()
const tasksSubs = new Set<() => void>()
const connectionSubs = new Set<(event: ConnectionChangedEvent) => void>()
// The node events after the first three, keyed by channel. One registry rather than one Set per event,
// because they share a shape: a core-named frame whose fields are the payload
// (@acorn/protocol/nodeEvents.ts).
type NodeEventMap = {
  'head:changed': HeadChangedEvent
  'run:changed': RunTargetChangedEvent
  'agent-session:changed': AgentSessionChangedEvent
  'project:changed': ProjectChangedEvent
  // Content-free: a session was created, exited, or flipped between working and idle.
  'terminal:sessions-changed': Record<string, never>
  'worktree:status-changed': WorktreeStatusChangedEvent
}
const nodeEventSubs = new Map<keyof NodeEventMap, Set<(event: never) => void>>()
const noticeSubs = new Set<NoticeCb>()
const stepEventSubs = new Set<StepEventCb>()
const reconnectSubs = new Set<() => void>()

const decoder = new TextDecoder()

let bridged = false
// Which nodes' sockets have been up at least once. A later transition to online is a reconnect, which
// means re-attach and refetch. The first connect means neither.
//
// Per node, not one flag. A single boolean read a second node's first connect as a reconnect, and
// re-attached every PTY subscription against the active node.
const everOnline = new Set<string>()

// The one send door. A channel owner needs it to attach and detach its own streams, and it is the only
// part of the socket a plugin can reach.
export function wsSend(frame: WsClientFrame): void {
  rawSend(frame)
}

function rawSend(frame: WsClientFrame): void {
  const nodeId = activeNodeId()
  if (!nodeId) return
  connect()
  // No local queue: main holds one, so a frame sent before its socket is open is still delivered.
  nodeTransport()?.send(nodeId, frame)
}

// Subscribe to the broker's push channels. Idempotent and never torn down, because this module is a
// singleton whose lifetime is the renderer's.
function connect(): void {
  if (bridged) return
  const transport = nodeTransport()
  if (!transport) return
  bridged = true

  // The nodeId is a filter, not decoration. Main opens a socket to every paired node and pushes every
  // frame here, while the subscriber maps below are keyed on session and exec ids alone. Without the
  // filter, node B's `term:out` for a colliding session id feeds node A's xterm
  // (docs/architecture-overview.md § Client state and fleet behavior).
  //
  // Dropping rather than routing works because only the active node's surfaces are subscribed. A
  // fleet-wide live surface would need a nodeId in the subscription key, not a wider filter here.
  transport.onFrame((nodeId, raw) => {
    if (nodeId !== activeNodeId()) return
    dispatch(raw)
  })
  // Terminal output, which does not arrive as a frame at all: it is bytes, tagged with the session
  // they belong to (@acorn/protocol/ws.ts § The one binary frame). One decode instead of a JSON parse
  // on the way in, and the same node filter as above, for the same reason.
  transport.onBytes((nodeId, frame) => {
    if (nodeId !== activeNodeId()) return
    const tagged = decodeIdFrame(frame)
    if (!tagged) return
    const subs = outputSubs.get(tagged.id)
    if (!subs) return
    // Decoded here rather than at each subscriber: `ServerMsg` output is text, which is what xterm and
    // the terminal client's emulator both take. One frame is one complete flush from the node, so a
    // plain decode is exact — there is no character split across two of them to carry over.
    const msg: ServerMsg = { type: 'output', data: decoder.decode(tagged.payload) }
    subs.forEach((cb) => cb(msg))
  })
  transport.onStatus((status) => {
    if (status.state !== 'online') return
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
  // The broker's gap detection strips `seq` before this point. Core reads `channel` and the owner
  // narrows the rest.
  routeWsFrame(raw as WsServerFrame)
}

// This file's own two prefixes (docs/api-reference.md § WebSocket). `term:` frames carry a per-session
// ServerMsg, `workflow:` carries the notification bell's notices and step events.
registerWsChannel(
  'term',
  (frame) => {
    if (frame.channel === 'term:status') {
      const { pluginId } = frame as { pluginId?: unknown }
      return statusSubs.forEach((cb) => cb(typeof pluginId === 'string' ? pluginId : undefined))
    }
    if (frame.channel !== 'term:out') return
    const { id, msg } = frame as { id?: unknown; msg?: unknown }
    if (typeof id !== 'string') return
    outputSubs.get(id)?.forEach((cb) => cb(msg as ServerMsg))
  },
  () => [...outputSubs.keys()].map((id) => ({ channel: 'term:attach', id })),
)

registerWsChannel('workflow', (frame) => {
  if (frame.channel === 'workflow:notice') return noticeSubs.forEach((cb) => cb(frame.notice as Parameters<NoticeCb>[0]))
  if (frame.channel === 'workflow:step:event') stepEventSubs.forEach((cb) => cb(frame as unknown as Parameters<StepEventCb>[0]))
})

// Core's third prefix (docs/api-reference.md § WebSocket). Content-free like `term:status`, so the
// subscriber re-reads the roster route (plugins/reload.ts).
registerWsChannel('plugins', (frame) => {
  if (frame.channel === 'plugins:changed') pluginsSubs.forEach((cb) => cb())
})

// And its fourth. A task was created, patched, archived, cancelled, or had its links change on the
// node — from this window, from another one, or from an agent (node-core/server/notify.ts). Content-free
// again: the subscriber invalidates the task-list query and refetches.
registerWsChannel('tasks', (frame) => {
  if (frame.channel === 'tasks:changed') tasksSubs.forEach((cb) => cb())
})

// And its fifth. A connection was made, rotated, tested, disabled, or demoted to `needs-auth` because
// its credential stopped working (node-core/server/notify.ts). The only core frame with a payload, so it
// is the only one that reads its own fields — narrowed here rather than at each subscriber, because a
// frame off the wire is `Record<string, unknown>` and every consumer would otherwise repeat the check.
registerWsChannel('connection', (frame) => {
  if (frame.channel !== 'connection:changed') return
  const { integrationId, providerId, status } = frame as Partial<ConnectionChangedEvent>
  if (typeof integrationId !== 'string' || typeof providerId !== 'string' || typeof status !== 'string') return
  connectionSubs.forEach((cb) => cb({ integrationId, providerId, status }))
})

// Core's sixth through eleventh: HEAD moved, a run target started or stopped, an agent session reached
// an edge, a project row or its config moved, a terminal session's roster moved, something under a
// task's worktree changed (docs/plugins.md § Hearing a core event). Each prefix is the noun before the
// colon, and the frame minus `channel` is the payload. Not narrowed field by field
// like `connection` above: the frame came from this node over the authenticated socket, and a
// subscriber that needs a field checked does it once at the point of use.
for (const prefix of ['head', 'run', 'agent-session', 'project', 'terminal', 'worktree']) {
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
  outputSubs.clear()
  statusSubs.clear()
  pluginsSubs.clear()
  tasksSubs.clear()
  connectionSubs.clear()
  noticeSubs.clear()
  stepEventSubs.clear()
  reconnectSubs.clear()
}

// Subscribe to one session's output. Detaching keeps the PTY running. Only the first local subscriber
// per session sends the attach frame, because the server restores one display snapshot per connection,
// and the last unsubscribe detaches.
export function wsAttach(id: string, on: OutputCb): () => void {
  let set = outputSubs.get(id)
  const first = !set
  if (!set) {
    set = new Set()
    outputSubs.set(id, set)
  }
  set.add(on)
  connect()
  if (first) rawSend({ channel: 'term:attach', id })
  return () => {
    const s = outputSubs.get(id)
    if (!s) return
    s.delete(on)
    if (s.size === 0) {
      outputSubs.delete(id)
      rawSend({ channel: 'term:detach', id })
    }
  }
}

export function wsWrite(id: string, data: string): void {
  rawSend({ channel: 'term:input', id, data })
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

// The node's task list moved. Same subscriber shape and the same reason: tasks/mutations.ts would be a
// cycle if this module reached into it.
export function wsOnTasksChanged(cb: () => void): () => void {
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

