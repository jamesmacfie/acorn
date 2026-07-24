// The renderer end of the one authenticated stream socket (docs/electron.md §12). Replaces the
// per-session `window.acorn.terminal.attach/write/onStatus` + `workflow.onNotice` IPC. One lazily-
// opened WebSocket, same-origin so the session cookie rides the upgrade automatically; it
// reconnects and re-attaches live subscriptions, and fans kind-tagged frames out to local callers.
import type { DockerStatsSample } from '../shared/docker'
import type { ServerMsg } from '../shared/terminal'
import { WS_PATH, type WsClientFrame, type WsServerFrame } from '../shared/ws'

type OutputCb = (m: ServerMsg) => void
type NoticeCb = (n: { taskId: string; kind: 'gate' | 'run-done' | 'repo-config-trust'; title: string; action?: 'review-config' }) => void
type StepEventCb = (event: { runId: string; stepId: string; event: unknown }) => void

const outputSubs = new Map<string, Set<OutputCb>>() // sessionId → local subscribers
const statusSubs = new Set<() => void>()
const noticeSubs = new Set<NoticeCb>()
const stepEventSubs = new Set<StepEventCb>()
const dockerChangedSubs = new Set<(scopes: string[]) => void>()
// Docker log/stats stream subscribers, keyed `${kind}:${id}` — mirrors outputSubs' first-attach /
// last-detach contract and the reconnect re-attach below.
export type DockerStreamEvent = { kind: 'log'; data: string } | { kind: 'stats'; sample: DockerStatsSample } | { kind: 'end' }
const dockerStreamSubs = new Map<string, Set<(event: DockerStreamEvent) => void>>()
// Interactive docker-exec PTYs: one listener per execId, no reconnect re-attach (the PTY dies with
// the connection — the component shows the exit and the user reopens).
export type DockerExecEvent = { kind: 'out'; data: string } | { kind: 'exit' }
const dockerExecSubs = new Map<string, (event: DockerExecEvent) => void>()
const outbox: WsClientFrame[] = [] // frames queued while the socket isn't OPEN

// UI control broker (docs/public-api.md): the renderer registers a window, reports
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
    for (const key of dockerStreamSubs.keys()) {
      const [kind, id] = splitStreamKey(key)
      sock.send(JSON.stringify({ channel: `docker:${kind}:attach`, id } satisfies WsClientFrame))
    }
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
    else if (frame.channel === 'docker:changed') dockerChangedSubs.forEach((cb) => cb(frame.scopes))
    else if (frame.channel === 'docker:log') dockerStreamSubs.get(`logs:${frame.id}`)?.forEach((cb) => cb({ kind: 'log', data: frame.data }))
    else if (frame.channel === 'docker:stats') dockerStreamSubs.get(`stats:${frame.id}`)?.forEach((cb) => cb({ kind: 'stats', sample: frame.sample }))
    else if (frame.channel === 'docker:stream-end') dockerStreamSubs.get(`${frame.kind}:${frame.id}`)?.forEach((cb) => cb({ kind: 'end' }))
    else if (frame.channel === 'docker:exec:out') dockerExecSubs.get(frame.execId)?.({ kind: 'out', data: frame.data })
    else if (frame.channel === 'docker:exec:exit') dockerExecSubs.get(frame.execId)?.({ kind: 'exit' })
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
    if (outputSubs.size || statusSubs.size || noticeSubs.size || stepEventSubs.size || dockerChangedSubs.size || dockerStreamSubs.size) connect()
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
