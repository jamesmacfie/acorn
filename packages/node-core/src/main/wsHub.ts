// The single authenticated WebSocket hub (docs/api-reference.md § WebSocket). It lives in the
// utility service beside the PTY engine: terminal.ts registers the stream handlers and notify.ts
// broadcasts pings through it. Attached to the @hono/node-server http.Server's 'upgrade' event so it
// shares the loopback listener and its Host guard.
import { verifyInternalToken, type InternalClaims } from '../server/auth/internalTokens'
import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import type { DeviceService } from '../server/auth/deviceTokens'
import type { ServerMsg } from '@acorn/protocol/terminal.ts'
import { WS_PATH, type WsClientFrame, type WsServerFrame, type WsServerWireFrame, wsFrameSchema } from '@acorn/protocol/ws.ts'
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
}
const conns = new Set<Conn>()
const hubDisposers = new WeakMap<Server, () => void>()

// Two unanswered pings, not one: a single miss on a congested link is not evidence, and the cost of
// being wrong is tearing down a working socket and every stream attached to it. The ping rides the
// existing revocation sweep rather than a second timer, so there is one cadence and one thing to
// unref.
const MISSED_PONGS_BEFORE_DEAD = 2

const MAX_BUFFERED_BYTES = 4 * 1024 * 1024

function sendFrame(conn: Conn, frame: WsServerFrame): void {
  // Increment even when the frame is dropped, so the omission is visible to the client as a gap.
  conn.seq += 1
  if (conn.ws.readyState !== conn.ws.OPEN) return
  if (conn.ws.bufferedAmount > MAX_BUFFERED_BYTES) return
  conn.ws.send(JSON.stringify({ ...frame, seq: conn.seq } satisfies WsServerWireFrame))
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
}

// True when any socket is connected. notify.ts uses the same "no window layer means no-op" idea for WS.
export const wsHasClients = (): boolean => conns.size > 0

export type WsAuthDeps = {
  internalToken: string
  // Held by reference and filled in once the listener knows its port (main/server.ts). A copy taken at
  // attach time is empty forever, which refuses every upgrade with no log line.
  allowedHosts: ReadonlySet<string>
  // Resolves the device bearer at upgrade and tells the hub when a device is revoked.
  devices: DeviceService
  // How often the backstop sweep re-checks each connection's device. docs/api-reference.md § Pairing pins the
  // production value at 60s; tests inject a short one instead of faking timers.
  revocationCheckMs?: number
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

function onConnect(ws: WebSocket, authorized: Authorized): void {
  const conn: Conn = { ws, sinks: new Map(), deviceId: authorized.deviceId, seq: 0, internal: authorized.internal, missedPongs: 0 }
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
        const sink: StreamSink = (msg) => sendFrame(conn, { channel: 'term:out', id: streamId, msg })
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
    // upgrade listener and cannot wait for our promise (main/upgradeClaim.ts).
    claimUpgrade(socket)
    void authorize(req, deps).then((authorized) => {
      if (!authorized) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => onConnect(ws, authorized))
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
  for (const c of conns) c.ws.close()
  conns.clear()
  handlers = null
  channelHandlers.clear()
}
