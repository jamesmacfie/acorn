// The renderer end of the one authenticated stream socket. It no longer owns a socket: Electron
// main's connection broker holds it, because the device token rides the upgrade request's headers
// and a browser cannot set those (docs/architecture-overview.md § Node API and client flow).
//
// What stayed here: the subscription registries, the first-attach/last-detach contract, and the
// re-attach-on-reconnect behaviour. What moved to the broker: the URL, the socket lifecycle, the
// local outbox (main queues frames until its socket is open), and the fixed 1s reconnect timer,
// replaced by the broker's own backoff.
//
// Dispatch is a prefix registry now (wsChannels.ts), not a flat if/else over every channel name.
// This file still owns the `term:` and `workflow:` prefixes: `term:` is core transport on both
// ends, the node's hub handles it inline before prefix dispatch so it can apply the task-scope
// check, and `workflow:notice` feeds core's own notification pipeline. `docker:` and `agent:` are
// registered by the plugins that own them.
import type { ServerMsg } from '@acorn/protocol/terminal.ts'
import type { WsClientFrame, WsServerFrame } from '@acorn/protocol/ws.ts'
import { nodeTransport } from './platform'
import { activeNodeId } from './node/activeNode'
import { registerWsChannel, routeWsFrame, wsReattachFrames, _resetWsChannels } from './wsChannels'

type OutputCb = (m: ServerMsg) => void
// Exported because subscribers outside this package (the terminal plugin's client) used to keep a
// hand-written twin of it, which drifted the moment a fourth kind was added. One declaration, imported.
export type WorkflowNotice = {
  taskId: string
  kind: 'gate' | 'run-done' | 'repo-config-trust' | 'plugin-request'
  title: string
  action?: 'review-config' | 'review-plugin-request'
}
type NoticeCb = (n: WorkflowNotice) => void
type StepEventCb = (event: { runId: string; stepId: string; event: unknown }) => void

const outputSubs = new Map<string, Set<OutputCb>>() // sessionId → local subscribers
const statusSubs = new Set<() => void>()
const pluginsSubs = new Set<() => void>()
const noticeSubs = new Set<NoticeCb>()
const stepEventSubs = new Set<StepEventCb>()
const reconnectSubs = new Set<() => void>()

let bridged = false
// Which nodes' sockets have been up at least once. A transition to online after that point is a
// reconnect, and reconnect means both re-attach and refetch; the first connect means neither.
//
// Per node, not one flag. A single boolean was set by whichever node connected first, so a second
// node's very first connect read as a reconnect: it re-attached every PTY subscription and told
// the shell to refetch, both against the active node, for an event that had nothing to do with it.
const everOnline = new Set<string>()

// The one send door. Exported because a channel owner needs it to attach and detach its own streams,
// and it is the only thing about the socket a plugin should be able to reach.
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

// Subscribe to the broker's push channels. Idempotent and never torn down: this module is a singleton
// whose lifetime is the renderer's.
function connect(): void {
  if (bridged) return
  const transport = nodeTransport()
  if (!transport) return
  bridged = true

  // The nodeId is a filter, not decoration. Main opens a socket to every paired node and pushes
  // every frame here, and this module's subscriber maps are keyed on session/container/exec ids
  // alone. Before this filter, node B's `term:out` for a session id that happened to collide fed
  // node A's xterm, and its `agent:*` frames mutated the managed-session store the Agent Center
  // renders for A. Two nodes must never collide in the client
  // (docs/architecture-overview.md § Client state and fleet behavior); the QueryClient partition
  // made that true for cached data, and this makes it true for the live stream.
  //
  // Dropping rather than routing is right for now: only the active node's surfaces are subscribed,
  // so a frame from any other node has no consumer. A fleet-wide live surface would need a nodeId
  // in the subscription key, not a wider filter here.
  transport.onFrame((nodeId, raw) => {
    if (nodeId !== activeNodeId()) return
    dispatch(raw)
  })
  transport.onStatus((status) => {
    if (status.state !== 'online') return
    if (!everOnline.has(status.nodeId)) {
      everOnline.add(status.nodeId)
      return
    }
    // A reconnect of some other node must not re-attach this node's PTYs or refetch its queries:
    // every `rawSend` below addresses the active node, and `reconnectSubs` invalidates the active
    // node's cache.
    if (status.nodeId !== activeNodeId()) return
    // Re-attach every live subscription: the node treats attach as idempotent per connection, so
    // this re-subscribes each PTY and restores its display snapshot. Each channel owner supplies
    // its own frames (wsChannels.ts); this loop no longer knows how to spell another prefix's
    // attach.
    for (const frame of wsReattachFrames()) rawSend(frame)
    // Reconnect means refetch (docs/api-reference.md § WebSocket): there is no cursor into
    // history, so the client marks the node's cache stale instead of replaying. The QueryClient
    // lives in the app shell, so this is announced rather than performed here.
    reconnectSubs.forEach((cb) => cb())
  })
}

function dispatch(raw: unknown): void {
  if (!raw || typeof raw !== 'object' || typeof (raw as { channel?: unknown }).channel !== 'string') return
  // `seq` is stripped by the broker's gap detection before we see it; the remaining value is the
  // channel-tagged event frame. Core reads only `channel`; the owner narrows the rest.
  routeWsFrame(raw as WsServerFrame)
}

// This file's own two prefixes (docs/api-reference.md § WebSocket). `term:` frames carry a
// per-session ServerMsg; `workflow:` carries the notification bell's notices and step events.
registerWsChannel(
  'term',
  (frame) => {
    if (frame.channel === 'term:status') return statusSubs.forEach((cb) => cb())
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

// Core's third prefix (docs/api-reference.md § WebSocket). Content-free like `term:status`; the
// subscriber re-reads the roster route (plugins/reload.ts).
registerWsChannel('plugins', (frame) => {
  if (frame.channel === 'plugins:changed') pluginsSubs.forEach((cb) => cb())
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
  // NOT _resetWsChannels(): this module registers its prefixes at import time, and clearing the map
  // would leave the whole socket mute for every later test in the file. A plugin's registration is
  // taken back by its own reset.
  everOnline.clear()
  outputSubs.clear()
  statusSubs.clear()
  pluginsSubs.clear()
  noticeSubs.clear()
  stepEventSubs.clear()
  reconnectSubs.clear()
}

// Subscribe to one session's output; returns an unsubscribe. Detaching keeps the PTY running.
// Only the first local subscriber per session sends the attach frame (the server restores one
// display snapshot per connection); the last unsubscribe detaches.
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

export function wsOnStatus(cb: () => void): () => void {
  statusSubs.add(cb)
  connect()
  return () => void statusSubs.delete(cb)
}

// A reload swapped a plugin's node half (docs/plugins.md § The dev loop). A subscriber, not a
// direct call into the plugin layer, because plugins/chrome already imports this module and the
// reverse edge would be a cycle.
export function wsOnPluginsChanged(cb: () => void): () => void {
  pluginsSubs.add(cb)
  connect()
  return () => void pluginsSubs.delete(cb)
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

