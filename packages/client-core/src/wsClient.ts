// The renderer end of the one authenticated stream socket. It no longer OWNS a socket: Electron main's
// connection broker holds it, because the device token rides the upgrade request's headers and a
// browser cannot set those (docs/vNext/architecture.md § How the client talks to nodes).
//
// What stayed: the subscription registries, the first-attach/last-detach contract, and the
// re-attach-on-reconnect behaviour. What went: the URL, the socket lifecycle, the local outbox (main
// queues frames until its socket is open) and the fixed 1s reconnect timer — backoff now lives in the
// broker, where the connection does.
//
// The dispatch table below is untouched, which is the point of keeping V1's flat channel-tagged frames
// rather than rewrapping them: all twelve consumers of this module are unchanged.
import type { DockerStatsSample } from '@acorn/protocol/docker.ts'
import type { ServerMsg } from '@acorn/protocol/terminal.ts'
import type { WsClientFrame, WsServerFrame } from '@acorn/protocol/ws.ts'
import { acornGlobal } from './capabilities'
import { activeNodeId } from './node/activeNode'

type OutputCb = (m: ServerMsg) => void
type NoticeCb = (n: { taskId: string; kind: 'gate' | 'run-done' | 'repo-config-trust'; title: string; action?: 'review-config' }) => void
type StepEventCb = (event: { runId: string; stepId: string; event: unknown }) => void
type AgentFrameCb = (frame:
  | { channel: 'agent:event'; event: unknown }
  | { channel: 'agent:session'; session: unknown }
  | { channel: 'agent:deleted'; sessionId: string }
) => void

const outputSubs = new Map<string, Set<OutputCb>>() // sessionId → local subscribers
const statusSubs = new Set<() => void>()
const noticeSubs = new Set<NoticeCb>()
const stepEventSubs = new Set<StepEventCb>()
const agentFrameSubs = new Set<AgentFrameCb>()
const dockerChangedSubs = new Set<(scopes: string[]) => void>()
// Docker log/stats stream subscribers, keyed `${kind}:${id}` — mirrors outputSubs' first-attach /
// last-detach contract and the reconnect re-attach below.
export type DockerStreamEvent = { kind: 'log'; data: string } | { kind: 'stats'; sample: DockerStatsSample } | { kind: 'end' }
const dockerStreamSubs = new Map<string, Set<(event: DockerStreamEvent) => void>>()
// Interactive docker-exec PTYs: one listener per execId, no reconnect re-attach (the PTY dies with
// the connection — the component shows the exit and the user reopens).
export type DockerExecEvent = { kind: 'out'; data: string } | { kind: 'exit' }
const dockerExecSubs = new Map<string, (event: DockerExecEvent) => void>()
const reconnectSubs = new Set<() => void>()

let bridged = false
// Whether the broker's socket has been up at least once. A transition to online AFTER that is a
// reconnect, and reconnect means both re-attach and refetch; the first connect means neither.
let everOnline = false

function rawSend(frame: WsClientFrame): void {
  const nodeId = activeNodeId()
  if (!nodeId) return
  connect()
  // No local queue: main holds one, so a frame sent before its socket is open is still delivered.
  acornGlobal()?.nodeSend?.(nodeId, frame)
}

// Subscribe to the broker's push channels. Idempotent and never torn down: this module is a singleton
// whose lifetime is the renderer's.
function connect(): void {
  if (bridged) return
  const bridge = acornGlobal()
  if (!bridge?.onNodeFrame) return
  bridged = true

  bridge.onNodeFrame((_nodeId, raw) => dispatch(raw))
  bridge.onNodeStatus?.((status) => {
    if (status.state !== 'online') return
    if (!everOnline) {
      everOnline = true
      return
    }
    // Re-attach every live subscription: the node treats attach as idempotent per connection, so this
    // re-subscribes each PTY and restores its display snapshot.
    for (const id of outputSubs.keys()) rawSend({ channel: 'term:attach', id })
    for (const key of dockerStreamSubs.keys()) {
      const [kind, id] = splitStreamKey(key)
      rawSend({ channel: `docker:${kind}:attach`, id })
    }
    // Reconnect means refetch (docs/vNext/protocol.md § Events): there is no cursor into history, so
    // the client marks the node's cache stale instead of replaying. The QueryClient lives in the app
    // shell, so this is announced rather than performed here.
    reconnectSubs.forEach((cb) => cb())
  })
}

function dispatch(raw: unknown): void {
  if (!raw || typeof raw !== 'object' || typeof (raw as { channel?: unknown }).channel !== 'string') return
  // `seq` is stripped by the broker's gap detection before we see it; the channel vocabulary is V1's.
  const frame = raw as WsServerFrame
  {
    if (frame.channel === 'term:out') outputSubs.get(frame.id)?.forEach((cb) => cb(frame.msg))
    else if (frame.channel === 'term:status') statusSubs.forEach((cb) => cb())
    else if (frame.channel === 'workflow:notice') noticeSubs.forEach((cb) => cb(frame.notice))
    else if (frame.channel === 'workflow:step:event') stepEventSubs.forEach((cb) => cb(frame))
    else if (frame.channel === 'agent:event' || frame.channel === 'agent:session' || frame.channel === 'agent:deleted') {
      agentFrameSubs.forEach((cb) => cb(frame))
    }
    else if (frame.channel === 'docker:changed') dockerChangedSubs.forEach((cb) => cb(frame.scopes))
    else if (frame.channel === 'docker:log') dockerStreamSubs.get(`logs:${frame.id}`)?.forEach((cb) => cb({ kind: 'log', data: frame.data }))
    else if (frame.channel === 'docker:stats') dockerStreamSubs.get(`stats:${frame.id}`)?.forEach((cb) => cb({ kind: 'stats', sample: frame.sample }))
    else if (frame.channel === 'docker:stream-end') dockerStreamSubs.get(`${frame.kind}:${frame.id}`)?.forEach((cb) => cb({ kind: 'end' }))
    else if (frame.channel === 'docker:exec:out') dockerExecSubs.get(frame.execId)?.({ kind: 'out', data: frame.data })
    else if (frame.channel === 'docker:exec:exit') dockerExecSubs.get(frame.execId)?.({ kind: 'exit' })
  }
}

// Fires when the node's socket comes back after a drop. The app shell uses it to mark that node's
// queries stale so whatever is on screen refetches.
export function wsOnReconnect(cb: () => void): () => void {
  reconnectSubs.add(cb)
  connect()
  return () => void reconnectSubs.delete(cb)
}

// Test seam: this module's singletons outlive a single test otherwise.
export function _resetWsClient(): void {
  bridged = false
  everOnline = false
  outputSubs.clear()
  statusSubs.clear()
  noticeSubs.clear()
  stepEventSubs.clear()
  agentFrameSubs.clear()
  dockerChangedSubs.clear()
  dockerStreamSubs.clear()
  dockerExecSubs.clear()
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

export function wsOnAgentFrame(cb: AgentFrameCb): () => void {
  agentFrameSubs.add(cb)
  connect()
  return () => void agentFrameSubs.delete(cb)
}

// Docker cache-dirty pings (the docker plugin's event-driven refresh edge).
export function wsOnDockerChanged(cb: (scopes: string[]) => void): () => void {
  dockerChangedSubs.add(cb)
  connect()
  return () => void dockerChangedSubs.delete(cb)
}

const splitStreamKey = (key: string): ['logs' | 'stats', string] => {
  const sep = key.indexOf(':')
  return [key.slice(0, sep) as 'logs' | 'stats', key.slice(sep + 1)]
}

// Open an interactive docker-exec PTY; returns a dispose that kills it. Input/resize ride the
// same socket via the exported senders.
export function wsDockerExecOpen(execId: string, ref: string, cols: number, rows: number, cb: (event: DockerExecEvent) => void): () => void {
  dockerExecSubs.set(execId, cb)
  connect()
  rawSend({ channel: 'docker:exec:open', execId, ref, cols, rows })
  return () => {
    dockerExecSubs.delete(execId)
    rawSend({ channel: 'docker:exec:kill', execId })
  }
}

export function wsDockerExecInput(execId: string, data: string): void {
  rawSend({ channel: 'docker:exec:in', execId, data })
}

export function wsDockerExecResize(execId: string, cols: number, rows: number): void {
  rawSend({ channel: 'docker:exec:resize', execId, cols, rows })
}

// Subscribe to a docker log/stats stream; returns an unsubscribe. First local subscriber per
// (kind, container) attaches, the last detaches — the wsAttach contract.
export function wsDockerAttach(kind: 'logs' | 'stats', id: string, cb: (event: DockerStreamEvent) => void): () => void {
  const key = `${kind}:${id}`
  let set = dockerStreamSubs.get(key)
  const first = !set
  if (!set) {
    set = new Set()
    dockerStreamSubs.set(key, set)
  }
  set.add(cb)
  connect()
  if (first) rawSend({ channel: `docker:${kind}:attach`, id })
  return () => {
    const s = dockerStreamSubs.get(key)
    if (!s) return
    s.delete(cb)
    if (s.size === 0) {
      dockerStreamSubs.delete(key)
      rawSend({ channel: `docker:${kind}:detach`, id })
    }
  }
}

