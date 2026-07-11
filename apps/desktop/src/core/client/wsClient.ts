// The renderer end of the one authenticated stream socket (docs/electron.md §12). Replaces the
// per-session `window.acorn.terminal.attach/write/onStatus` + `workflow.onNotice` IPC. One lazily-
// opened WebSocket, same-origin so the session cookie rides the upgrade automatically; it
// reconnects and re-attaches live subscriptions, and fans kind-tagged frames out to local callers.
import type { ServerMsg } from '../shared/terminal'
import { WS_PATH, type WsClientFrame, type WsServerFrame } from '../shared/ws'

type OutputCb = (m: ServerMsg) => void
type NoticeCb = (n: { taskId: string; kind: 'gate' | 'run-done' | 'repo-config-trust'; title: string; action?: 'review-config' }) => void
type StepEventCb = (event: { runId: string; stepId: string; event: unknown }) => void

const outputSubs = new Map<string, Set<OutputCb>>() // sessionId → local subscribers
const statusSubs = new Set<() => void>()
const noticeSubs = new Set<NoticeCb>()
const stepEventSubs = new Set<StepEventCb>()
const outbox: WsClientFrame[] = [] // frames queued while the socket isn't OPEN

// UI control broker (docs/next/api/commands-and-ui.md §4): the renderer registers a window, reports
// state snapshots, and executes ui:command frames the main broker forwards from public callers.
export type UiCommandResult =
  | { ok: true; result: unknown; revision: number }
  | { ok: false; error: { code: string; message: string; details?: unknown }; revision: number }
type UiCommandHandler = (commandId: string, input: unknown, expectedRevision?: number) => Promise<UiCommandResult>
let uiHandler: UiCommandHandler | null = null
let uiRegistration: { windowId: string; primary: boolean; snapshot: unknown } | null = null

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
    // Re-register the UI control window on reconnect so the broker regains its control connection.
    if (uiRegistration) sock.send(JSON.stringify({ channel: 'ui:register', ...uiRegistration } satisfies WsClientFrame))
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
    else if (frame.channel === 'ui:command') {
      const handler = uiHandler
      if (!handler) return
      const { requestId } = frame
      void handler(frame.commandId, frame.input, frame.expectedRevision)
        .then((r) => rawSend(r.ok
          ? { channel: 'ui:command-result', requestId, ok: true, result: r.result, revision: r.revision }
          : { channel: 'ui:command-result', requestId, ok: false, error: r.error, revision: r.revision }))
        .catch((e) => rawSend({ channel: 'ui:command-result', requestId, ok: false, error: { code: 'internal_error', message: e instanceof Error ? e.message : 'command failed' }, revision: uiRegistration ? (uiRegistration.snapshot as { revision?: number })?.revision ?? 0 : 0 }))
    }
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

// Register this window as the UI control connection and handle incoming ui:command frames. `handler`
// maps a public command id + input to a reducer action and returns the result + new revision. The
// app calls this after startup restore with an initial snapshot; wsSendUiState pushes updates.
export function wsRegisterUi(windowId: string, primary: boolean, snapshot: unknown, handler: UiCommandHandler): () => void {
  uiHandler = handler
  uiRegistration = { windowId, primary, snapshot }
  connect()
  rawSend({ channel: 'ui:register', windowId, primary, snapshot })
  return () => {
    uiHandler = null
    uiRegistration = null
  }
}

export function wsSendUiState(windowId: string, snapshot: unknown): void {
  if (uiRegistration) uiRegistration = { ...uiRegistration, snapshot }
  rawSend({ channel: 'ui:state', windowId, snapshot })
}
