// The renderer end of the one authenticated stream socket (docs/next Phase 3 slice 6). Replaces the
// per-session `window.acorn.terminal.attach/write/onStatus` + `workflow.onNotice` IPC. One lazily-
// opened WebSocket, same-origin so the session cookie rides the upgrade automatically; it
// reconnects and re-attaches live subscriptions, and fans kind-tagged frames out to local callers.
import type { ServerMsg } from '../../../shared/terminal'
import { WS_PATH, type WsClientFrame, type WsServerFrame } from '../../../shared/ws'

type OutputCb = (m: ServerMsg) => void
type NoticeCb = (n: { taskId: string; kind: 'gate' | 'run-done'; title: string }) => void
type StepEventCb = (event: { runId: string; stepId: string; event: unknown }) => void

const outputSubs = new Map<string, Set<OutputCb>>() // sessionId → local subscribers
const statusSubs = new Set<() => void>()
const noticeSubs = new Set<NoticeCb>()
const stepEventSubs = new Set<StepEventCb>()
const outbox: WsClientFrame[] = [] // frames queued while the socket isn't OPEN

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

const wsUrl = () => `${location.origin.replace(/^http/, 'ws')}${WS_PATH}`

function rawSend(frame: WsClientFrame): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame))
  else {
    outbox.push(frame)
    connect()
  }
}

function connect(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
  const sock = new WebSocket(wsUrl())
  ws = sock
  sock.onopen = () => {
    // Re-attach every live subscription so a reconnect (or a reload) re-subscribes the PTY and
    // replays its ring — the server treats attach as idempotent per connection.
    for (const id of outputSubs.keys()) sock.send(JSON.stringify({ channel: 'term:attach', id } satisfies WsClientFrame))
    for (const frame of outbox.splice(0)) sock.send(JSON.stringify(frame))
  }
  sock.onmessage = (e) => {
    let frame: WsServerFrame
    try {
      frame = JSON.parse(typeof e.data === 'string' ? e.data : '') as WsServerFrame
    } catch {
      return
    }
    if (frame.channel === 'term:out') outputSubs.get(frame.id)?.forEach((cb) => cb(frame.msg))
    else if (frame.channel === 'term:status') statusSubs.forEach((cb) => cb())
    else if (frame.channel === 'workflow:notice') noticeSubs.forEach((cb) => cb(frame.notice))
    else if (frame.channel === 'workflow:step:event') stepEventSubs.forEach((cb) => cb(frame))
  }
  const drop = () => {
    if (ws === sock) ws = null
    scheduleReconnect()
  }
  sock.onclose = drop
  sock.onerror = () => sock.close()
}

function scheduleReconnect(): void {
  if (reconnectTimer) return
  // ponytail: fixed 1s backoff; enough for a hardened loopback listener that only drops on quit.
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (outputSubs.size || statusSubs.size || noticeSubs.size || stepEventSubs.size) connect()
  }, 1000)
}

// Subscribe to one session's output; returns an unsubscribe. Detaching keeps the PTY running.
// Only the first local subscriber per session sends the attach frame (the server replays once per
// connection); the last unsubscribe detaches.
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
