// The single authenticated WebSocket hub (docs/api-reference.md § WebSocket). It lives in the
// utility service beside the PTY engine: terminal.ts registers the stream handlers and notify.ts
// broadcasts pings through it. Attached to the @hono/node-server http.Server's 'upgrade' event so it
// shares the loopback listener and its Host guard.
import { verifyInternalToken, type InternalClaims } from '../auth/internalTokens'
import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import type { DeviceService } from '../auth/deviceTokens'
import type { ServerMsg } from '@acorn/protocol/terminal.ts'
import { encodeIdFrame, WS_PATH, type WsClientFrame, type WsServerFrame, type WsServerWireFrame, wsFrameSchema } from '@acorn/protocol/ws.ts'
import { claimUpgrade } from './upgradeClaim'

// A sink is one connection's outlet for a session's ServerMsg frames. terminal.ts adds and removes it
// from a session's subscriber set on attach/detach and calls it to push output.
export type StreamSink = (msg: ServerMsg) => void

// The engine handlers the hub routes client frames to (registered by terminal.ts). attach registers
// the sink synchronously; the terminal engine owns canonical-snapshot-before-live ordering.
export type StreamHandlers = {
  input(id: string, data: string): void
  attach(id: string, sink: StreamSink): void
  detach(id: string, sink: StreamSink): void
  // Which task a stream belongs to, or null/undefined when the id is unknown. Required for the
  // task-scope check in onConnect: a task-scoped internal credential may only drive its own task's
  // streams, and only the engine that owns the sessions can answer that question.
  streamTaskId(id: string): string | null | undefined
  // Stop and start the thing producing this stream's bytes. The hub calls this when a socket buffers
  // past its mark, so a build spewing output slows down instead of having its frames thrown away
  // (docs/terminal.md § Backpressure). Optional because not every stream has a producer that can be
  // paused; a stream owner that offers none is shed instead, and told so.
  flowControl?(id: string, paused: boolean): void
}

let handlers: StreamHandlers | null = null
export const setStreamHandlers = (h: StreamHandlers | null): void => void (handlers = h)

// Generic channel handlers: a plugin claims a channel prefix (the token before the first ':', e.g.
// 'docker') and receives every client frame on it plus a disconnect signal per connection. `conn` is
// an opaque per-connection identity token. Key subscription maps by it, never look inside.
export type WsChannelHandler = {
  onFrame(frame: WsClientFrame, send: (frame: WsServerFrame) => void, conn: object): void
  onDisconnect(conn: object): void
}

const channelHandlers = new Map<string, WsChannelHandler>()

export function registerWsChannelHandler(prefix: string, handler: WsChannelHandler | null): void {
  if (handler) channelHandlers.set(prefix, handler)
  else channelHandlers.delete(prefix)
}

// `deviceId` is null for an internal-token socket, the one credential kind with no device row to
// revoke. `seq` is this connection's own counter (docs/api-reference.md § Events), so a
// reconnect legitimately restarts at 1 and the client compares only within one socket's lifetime.
type Conn = {
  ws: WebSocket
  sinks: Map<string, StreamSink>
  deviceId: string | null
  seq: number
  // The claims of an internal credential, when this socket authenticated with one. Retained rather
  // than discarded at the door: this is what onConnect and mayDriveStream need to enforce task scope
  // (docs/security.md § Transport and auth).
  internal?: InternalClaims
  missedPongs: number
  // Streams this connection has asked the engine to pause, and whether it has already told the client
  // that non-stream frames are being shed. Both are cleared when the socket drains or closes.
  held: Set<string>
  shedding: boolean
  drainTimer: ReturnType<typeof setInterval> | null
  // Where this socket's buffer is considered too far behind. Per connection rather than a module
  // constant only so a test can drive the behaviour with a real socket instead of four megabytes of
  // real traffic (see `maxBufferedBytes` on WsAuthDeps).
  mark: number
}
const conns = new Set<Conn>()
const hubDisposers = new WeakMap<Server, () => void>()

// Two unanswered pings, not one: a single miss on a congested link is not evidence, and the cost of
// being wrong is tearing down a working socket and every stream attached to it. The ping rides the
// existing revocation sweep rather than a second timer, so there is one cadence and one thing to
// unref.
const MISSED_PONGS_BEFORE_DEAD = 2

const MAX_BUFFERED_BYTES = 4 * 1024 * 1024
// Where a paused producer is let go again: half the mark rather than the mark itself, so a socket
// hovering at the line does not pause and resume once per frame.
const resumeBelow = (mark: number) => mark / 2
// `ws` has no drain event, so the mark is polled. 50 ms is a frame or three of terminal output at the
// engine's 16 ms coalescing tick, which is short enough that a resumed build does not stutter.
const DRAIN_POLL_MS = 50

// How many connections are holding each stream paused. A session attached to two clients is paused
// while either of them is behind, and resumed only when both have caught up: `pause()` is a property
// of the producer, not of one socket.
const holds = new Map<string, number>()

function holdStream(conn: Conn, id: string): void {
  if (conn.held.has(id)) return
  conn.held.add(id)
  const next = (holds.get(id) ?? 0) + 1
  holds.set(id, next)
  if (next === 1) handlers?.flowControl?.(id, true)
}

function releaseStream(conn: Conn, id: string): void {
  if (!conn.held.delete(id)) return
  const next = (holds.get(id) ?? 1) - 1
  if (next <= 0) {
    holds.delete(id)
    handlers?.flowControl?.(id, false)
  } else {
    holds.set(id, next)
  }
}

function releaseAll(conn: Conn): void {
  for (const id of [...conn.held]) releaseStream(conn, id)
  conn.shedding = false
  if (conn.drainTimer) clearInterval(conn.drainTimer)
  conn.drainTimer = null
}

function watchDrain(conn: Conn): void {
  if (conn.drainTimer) return
  conn.drainTimer = setInterval(() => {
    if (conn.ws.readyState !== conn.ws.OPEN || conn.ws.bufferedAmount <= resumeBelow(conn.mark)) releaseAll(conn)
  }, DRAIN_POLL_MS)
  conn.drainTimer.unref?.()
}

// One frame out, and the whole of this node's backpressure policy.
//
// It used to drop a frame when the socket buffered past the mark and increment `seq` anyway, so the
// client saw a gap; the broker reads a gap as loss and closes the socket
// (@acorn/custody/broker/nodeBroker.ts), reconnect re-attaches every terminal, and each re-attach
// makes the node serialise a framebuffer while the client refetches its active queries. A build
// spewing output was answered with more load, at the moment the node was busiest
// (docs/performance.md).
//
// Now: a stream frame over the mark is still sent, and its producer is paused until the socket drains.
// Nothing is dropped, so nothing is lost. A frame with no producer to pause — an invalidation ping —
// is shed, and a `ws:shed` marker takes its sequence number so the client is told it missed something
// and the broker sees no gap. Later sheds in the same congested window consume no sequence number at
// all, because one "you are behind" is the whole message.
function sendFrame(conn: Conn, frame: WsServerFrame): void {
  if (conn.ws.readyState !== conn.ws.OPEN) {
    // Nobody will read this socket's sequence again. Kept incrementing so the counter still describes
    // what was offered to a connection that is on its way out.
    conn.seq += 1
    return
  }
  if (conn.ws.bufferedAmount > conn.mark) {
    const { id } = frame as { id?: unknown }
    const streamId = frame.channel === 'term:out' && typeof id === 'string' ? id : null
    if (streamId) {
      holdStream(conn, streamId)
      watchDrain(conn)
      // and fall through: the frame goes out. Dropping bytes out of the middle of a terminal stream
      // corrupts the screen, and there is no cursor to replay from.
    } else {
      watchDrain(conn)
      if (conn.shedding) return
      conn.shedding = true
      conn.seq += 1
      conn.ws.send(JSON.stringify({ channel: 'ws:shed', seq: conn.seq } satisfies WsServerWireFrame))
      return
    }
  }
  conn.seq += 1
  conn.ws.send(JSON.stringify({ ...frame, seq: conn.seq } satisfies WsServerWireFrame))
}

// Terminal output, as one binary frame instead of an escaped JSON string.
//
// The bytes were bytes when the pseudo-terminal produced them, and this used to be the one channel that
// re-escaped them once per attached socket and again on the helper hop, at 60 frames a second while a
// build talks (docs/performance.md). The frame is the session id and then the
// payload (@acorn/protocol/ws.ts § The one binary frame); the desktop broker forwards it without
// looking inside, and the renderer's bridge tags it with the node id.
//
// Everything the JSON path does is still done here: the same backpressure decision, and the same
// refusal to drop bytes out of the middle of a stream. What it does not do is take a sequence number,
// because output has never been part of the invalidation channel's gap detection.
const encoder = new TextEncoder()
// One encode per broadcast rather than one per socket: the engine hands the same ServerMsg to every
// sink attached to a session, so the frame is built by whichever sink asks first. Weak, so a message
// nobody holds any more takes its frame with it.
const encodedOutput = new WeakMap<ServerMsg, Uint8Array | null>()

function outputFrame(id: string, msg: ServerMsg & { type: 'output' }): Uint8Array | null {
  let frame = encodedOutput.get(msg)
  if (frame === undefined) {
    frame = encodeIdFrame(id, encoder.encode(msg.data))
    encodedOutput.set(msg, frame)
  }
  return frame
}

function sendStreamFrame(conn: Conn, id: string, msg: ServerMsg): void {
  // `ready`, `exit` and `error` are one frame per attach or per lifetime, and they carry a session
  // object rather than bytes. They stay JSON.
  if (msg.type !== 'output') return sendFrame(conn, { channel: 'term:out', id, msg })
  const frame = outputFrame(id, msg)
  // An id this frame cannot spell (@acorn/protocol/ws.ts). The JSON path still works, so say it that
  // way rather than dropping a terminal's output.
  if (!frame) return sendFrame(conn, { channel: 'term:out', id, msg })
  if (conn.ws.readyState !== conn.ws.OPEN) return
  if (conn.ws.bufferedAmount > conn.mark) {
    holdStream(conn, id)
    watchDrain(conn)
    // and fall through, for the reason sendFrame gives: there is no cursor to replay a hole from.
  }
  conn.ws.send(frame, { binary: true })
}

// Is this connection confined to a single task? The socket-level twin of requireUser.ts's
// `isTaskConfined`, kept here rather than imported because that one reads a Hono context and this one
// reads a Conn: same rule, two different carriers of the same claims.
const isConfined = (conn: Conn): boolean => !!conn.internal && conn.internal.scope !== 'service'

// Session-status pings and workflow notices go to every open socket (notify.ts); a session's own
// output goes only to attached sockets, through their per-session sink. A task-confined socket
// receives none of this (docs/security.md § Transport and auth).
export function wsBroadcast(frame: WsServerFrame): void {
  for (const c of conns) {
    if (isConfined(c)) continue
    sendFrame(c, frame)
  }
  for (const listener of nodeListeners) {
    // A plugin's listener throwing must not cost the other subscribers their frame, and must not
    // unwind into whatever core call did the broadcast.
    try {
      listener(frame)
    } catch (error) {
      console.warn('[ws] a node-side event listener threw:', error)
    }
  }
}

// Node-side subscribers on the same frames the sockets get: `ctx.events.on`
// (server/pluginHost/types.ts, docs/plugins.md § Hearing another plugin). They receive whether or not a client
// is connected, which is the point — a node with nobody attached still has to react to its own events.
const nodeListeners = new Set<(frame: WsServerFrame) => void>()

/** Subscribe to every broadcast frame. Filtering by channel, and the grant that decides which channels
 *  a plugin may name, both belong to the caller (server/pluginHost/context.ts). */
export function onWsBroadcast(listener: (frame: WsServerFrame) => void): () => void {
  nodeListeners.add(listener)
  return () => void nodeListeners.delete(listener)
}

// True when any socket is connected. notify.ts uses the same "no window layer means no-op" idea for WS.
export const wsHasClients = (): boolean => conns.size > 0

export type WsAuthDeps = {
  internalToken: string
  // Held by reference and filled in once the listener knows its port (server/transport/listener.ts). A copy taken at
  // attach time is empty forever, which refuses every upgrade with no log line.
  allowedHosts: ReadonlySet<string>
  // Resolves the device bearer at upgrade and tells the hub when a device is revoked.
  devices: DeviceService
  // How often the backstop sweep re-checks each connection's device. docs/api-reference.md § Pairing pins the
  // production value at 60s; tests inject a short one instead of faking timers.
  revocationCheckMs?: number
  // Where a socket's buffer counts as too far behind, in bytes. Production is the 4 MiB constant above;
  // a test sets it low so the pause and the resume can be driven over a real socket rather than by
  // pushing megabytes through one.
  maxBufferedBytes?: number
}

// What a successful upgrade resolved to. `deviceId` is what makes revocation actionable later: a
// socket holds no bearer to re-present, so the connection has to remember which device it belongs to.
type Authorized = { deviceId: string | null; internal?: InternalClaims }

export async function authorizeWsUpgrade(req: IncomingMessage, deps: WsAuthDeps): Promise<Authorized | null> {
  return authorize(req, deps)
}

export type { Authorized as AuthorizedWsUpgrade }

async function authorize(req: IncomingMessage, deps: WsAuthDeps): Promise<Authorized | null> {
  if (!deps.allowedHosts.has(req.headers.host ?? '')) return null
  const bearer = req.headers.authorization
  if (bearer?.startsWith('Bearer ')) {
    // A bearer that fails does not fall through to the internal token: presenting a credential and
    // having it rejected is a rejection, not an invitation to try the next mechanism.
    const authenticated = await deps.devices.authenticate(bearer.slice('Bearer '.length).trim())
    return authenticated ? { deviceId: authenticated.deviceId } : null
  }
  const token = req.headers['x-acorn-internal']
  // HMAC-verified, not compared with `===`, which used to leak the token's length and a prefix-match
  // position through timing. INTERNAL_TOKEN is now a signing key rather than the credential
  // (server/auth/internalTokens.ts). An internal socket still gets `deviceId: null`, since it has no
  // device row to revoke, but the claims are carried so a future sweep can close a task's sockets when
  // the task ends.
  if (typeof token !== 'string' || !token) return null
  const claims = verifyInternalToken(deps.internalToken, token)
  return claims ? { deviceId: null, internal: claims } : null
}

// May this connection address the stream `id`?
//
// Device sockets and the 'service' scope: yes. A 'task'-scoped internal socket: only when the stream
// belongs to that task. The engine answers the ownership question because it owns the session map.
function mayDriveStream(conn: Conn, id: string | null): boolean {
  if (!isConfined(conn)) return true
  if (!id || !conn.internal?.taskId) return false
  return handlers?.streamTaskId(id) === conn.internal.taskId
}

function onConnect(ws: WebSocket, authorized: Authorized, mark: number): void {
  const conn: Conn = { ws, sinks: new Map(), deviceId: authorized.deviceId, seq: 0, internal: authorized.internal, missedPongs: 0, held: new Set(), shedding: false, drainTimer: null, mark }
  conns.add(conn)
  ws.on('pong', () => {
    conn.missedPongs = 0
  })
  ws.on('message', (raw) => {
    let frame: WsClientFrame
    try {
      const parsed = wsFrameSchema.safeParse(JSON.parse(raw.toString()))
      if (!parsed.success) return
      frame = parsed.data
    } catch {
      return // non-JSON noise, ignore defensively
    }
    if (frame.channel.startsWith('term:')) {
      if (!handlers) return
      // Scope check before any handler runs (docs/security.md § Transport and auth). Narrowed once,
      // here, because the frame envelope is open now (@acorn/protocol/ws.ts): the runtime guards below
      // are load-bearing on their own, since the union only ever proved the shapes to the compiler,
      // never to a peer sending JSON.
      const { id, data } = frame as { id?: unknown; data?: unknown }
      const streamId = typeof id === 'string' ? id : null
      if (!mayDriveStream(conn, streamId)) return
      if (!streamId) return
      if (frame.channel === 'term:input') {
        if (typeof data === 'string') handlers.input(streamId, data)
      } else if (frame.channel === 'term:attach') {
        if (conn.sinks.has(streamId)) return
        const sink: StreamSink = (msg) => sendStreamFrame(conn, streamId, msg)
        conn.sinks.set(streamId, sink)
        handlers.attach(streamId, sink) // engine restores the canonical screen before queued live frames
      } else if (frame.channel === 'term:detach') {
        const sink = conn.sinks.get(streamId)
        if (sink) {
          handlers.detach(streamId, sink)
          conn.sinks.delete(streamId)
        }
      }
      return
    }
    // Every non-`term:` channel is refused outright for a task-confined socket, the same posture
    // workflows' node-wide trigger-poll route takes: there is no task to narrow the frame to, so the
    // only honest answer is no (docs/security.md § Transport and auth, on the docker-exec finding this
    // check closes).
    //
    // A per-channel opt-in on WsChannelHandler was considered and rejected: docker browse and exec are
    // a renderer surface with no agent consumer, so the opt-in would have no takers, and the safe
    // default has to be the one a channel added later inherits.
    if (isConfined(conn)) return
    channelHandlers.get(frame.channel.split(':')[0])?.onFrame(frame, (f) => sendFrame(conn, f), conn)
  })
  const cleanup = () => {
    if (!conns.delete(conn)) return // 'error' and 'close' can both fire, run once
    // Before the detaches: a socket that died while it was behind must not leave the PTY it was
    // holding paused forever. That would be a session that never produces output again.
    releaseAll(conn)
    for (const [id, sink] of conn.sinks) handlers?.detach(id, sink)
    conn.sinks.clear()
    for (const handler of channelHandlers.values()) handler.onDisconnect(conn)
  }
  ws.on('close', cleanup)
  ws.on('error', cleanup)
}

// Terminate every socket belonging to a revoked device. `terminate()` rather than `close()`: an
// invalidated credential must not keep a socket alive for a graceful closing handshake
// (docs/api-reference.md § Pairing: "open sockets are closed, in-flight requests fail").
function dropDevice(deviceId: string): void {
  for (const conn of [...conns]) {
    if (conn.deviceId === deviceId) conn.ws.terminate()
  }
}

export function attachWsHub(server: Server, deps: WsAuthDeps): void {
  const wss = new WebSocketServer({ noServer: true })
  // Immediate path: the revoke that happened in this process tells us directly.
  const offRevoked = deps.devices.onRevoked(dropDevice)
  // Backstop for long-lived streams (docs/api-reference.md § Pairing, docs/security.md § Transport and
  // auth). It covers a revoke this hub never heard about, another process, or a listener registered
  // after the revoke, which is exactly the case a live socket cannot detect since it holds no bearer
  // to re-present.
  const sweep = setInterval(() => {
    for (const conn of [...conns]) {
      // Liveness first, and synchronously: a socket whose peer has vanished is one this hub should stop
      // holding stream subscriptions open for, and asking the database whether its device is still active
      // tells us nothing about that. Checked before the ping is sent, so the count read here is of pings
      // that have already had a full interval to be answered.
      if (conn.missedPongs >= MISSED_PONGS_BEFORE_DEAD) {
        conn.ws.terminate()
        continue
      }
      conn.missedPongs += 1
      try {
        conn.ws.ping()
      } catch {
        conn.ws.terminate()
        continue
      }
    }
    void (async () => {
      for (const conn of [...conns]) {
        if (conn.deviceId && !(await deps.devices.isActive(conn.deviceId))) conn.ws.terminate()
      }
    })()
  }, deps.revocationCheckMs ?? 60_000)
  // A background sweep must never be the reason the process stays alive.
  sweep.unref?.()
  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    // Only claim our path. Other upgrades, if any, are left for their own handlers.
    let path: string
    try {
      // Only a syntactic base for parsing the path out. A request with no Host is refused by
      // authorize() below regardless, so the placeholder never decides anything.
      path = new URL(req.url ?? '', `http://${req.headers.host ?? 'placeholder.invalid'}`).pathname
    } catch {
      socket.destroy()
      return
    }
    if (path !== WS_PATH) return
    // Synchronously, before the async authorize below: the "nobody answered" sweeper runs as the last
    // upgrade listener and cannot wait for our promise (server/transport/upgradeClaim.ts).
    claimUpgrade(socket)
    void authorize(req, deps).then((authorized) => {
      if (!authorized) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => onConnect(ws, authorized, deps.maxBufferedBytes ?? MAX_BUFFERED_BYTES))
    })
  }
  server.on('upgrade', onUpgrade)
  hubDisposers.set(server, () => {
    server.off('upgrade', onUpgrade)
    clearInterval(sweep)
    offRevoked()
    for (const conn of [...conns]) conn.ws.terminate()
    wss.close()
  })
}

export function disposeWsHub(server: Server): void {
  hubDisposers.get(server)?.()
  hubDisposers.delete(server)
}

// Test-only reset so the module singleton doesn't leak connections between cases.
export function _resetWsHub(): void {
  for (const c of conns) {
    if (c.drainTimer) clearInterval(c.drainTimer)
    c.ws.close()
  }
  conns.clear()
  holds.clear()
  handlers = null
  channelHandlers.clear()
}
