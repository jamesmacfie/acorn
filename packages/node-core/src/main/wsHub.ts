// The single authenticated WebSocket hub (docs/electron.md §12): one socket on the loopback
// origin carries every live stream (shared/ws.ts). It lives in the utility service beside the
// PTY engine; terminal.ts registers the stream handlers, notify.ts broadcasts the
// pings through it. Attached to the @hono/node-server http.Server's 'upgrade' event so it shares
// the loopback listener and its Host guard.
import { verifyInternalToken, type InternalClaims } from '../server/auth/internalTokens'
import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import type { DeviceService } from '../server/auth/deviceTokens'
import type { ServerMsg } from '@acorn/protocol/terminal.ts'
import { WS_PATH, type WsClientFrame, type WsServerFrame, type WsServerWireFrame } from '@acorn/protocol/ws.ts'

// A sink is one connection's outlet for a session's ServerMsg frames — terminal.ts adds/removes it
// from a session's subscriber set on attach/detach and calls it to push output.
export type StreamSink = (msg: ServerMsg) => void

// The engine handlers the hub routes client frames to (registered by terminal.ts). attach registers
// the sink synchronously; the terminal engine owns canonical-snapshot-before-live ordering.
export type StreamHandlers = {
  input(id: string, data: string): void
  attach(id: string, sink: StreamSink): void
  detach(id: string, sink: StreamSink): void
  // Which task a stream belongs to, or null/undefined when the id is unknown. Required for the
  // task-scope check in onConnect: a task-scoped internal credential may only drive its OWN task's
  // streams, and only the engine that owns the sessions can answer that question.
  streamTaskId(id: string): string | null | undefined
}

let handlers: StreamHandlers | null = null
export const setStreamHandlers = (h: StreamHandlers | null): void => void (handlers = h)

// Generic channel handlers: a plugin claims a channel prefix (the token before the first ':', e.g.
// 'docker') and receives every client frame on it plus a disconnect signal per connection. `conn`
// is an opaque per-connection identity token — key subscription maps by it, never look inside.
export type WsChannelHandler = {
  onFrame(frame: WsClientFrame, send: (frame: WsServerFrame) => void, conn: object): void
  onDisconnect(conn: object): void
}

const channelHandlers = new Map<string, WsChannelHandler>()

export function registerWsChannelHandler(prefix: string, handler: WsChannelHandler | null): void {
  if (handler) channelHandlers.set(prefix, handler)
  else channelHandlers.delete(prefix)
}

// `deviceId` is null for an internal-token socket — the one credential kind with no device row to
// revoke. `seq` is this connection's own counter (docs/vNext/protocol.md § Events), so a
// reconnect legitimately restarts at 1 and the client compares only within one socket's lifetime.
type Conn = {
  ws: WebSocket
  sinks: Map<string, StreamSink>
  deviceId: string | null
  seq: number
  // The claims of an internal credential, when this socket authenticated with one. Retained rather than
  // discarded at the door: without it a 'task'-scoped token could attach to, and type into, ANY task's
  // pseudo-terminal — arbitrary command execution as the owner in another task's shell, which is
  // exactly what scoping the token was supposed to prevent.
  internal?: InternalClaims
}
const conns = new Set<Conn>()
const hubDisposers = new WeakMap<Server, () => void>()

// Per-connection ceiling on unflushed bytes. A remote link that stops draining is the case this
// exists for: a PTY producing faster than the socket drains would otherwise grow the send buffer
// without bound inside the service process.
//
// ponytail: dropping frames is the crude version of protocol.md § Streams' credit scheme (client
// grants bytes, server never exceeds outstanding credit), which is the Phase 2 replacement. It is
// safe in the meantime *because* seq is stamped before the drop: the client sees the gap and does what
// the protocol says — reconnect and refetch — rather than silently rendering a hole.
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
// reads a Conn — same rule, two different carriers of the same claims.
//
// A device is the owner and a 'service'-scoped token is the node calling itself; both are unconfined.
const isConfined = (conn: Conn): boolean => !!conn.internal && conn.internal.scope !== 'service'

// Session-status pings + workflow notices go to every open socket (notify.ts). Sessions' own output
// goes only to attached sockets, via their per-session sink.
//
// A task-confined socket receives NOTHING from here, and the reason is that not one broadcast frame is
// task-addressed, so there is nothing to narrow: `workflow:step:event` carries a whole agent turn's raw
// stream (assistant text and tool results) keyed only by runId, `workflow:notice` carries another task's
// title, `agent:session`/`agent:event` carry another task's session, and `term:status`/`docker:changed`
// are content-free cache-dirty pings whose only value is to a UI. So the filter is the frame-shaped
// equivalent of the HTTP side, which now 404s a foreign run — without it the socket handed back exactly
// what those route guards had just taken away.
//
// Rejected: filtering per channel on a taskId in the payload. Only `workflow:notice` has one; runId and
// sessionId would each need a lookup through a plugin the hub must not know about, and the default for a
// channel added later would silently be "leak it".
export function wsBroadcast(frame: WsServerFrame): void {
  for (const c of conns) {
    if (isConfined(c)) continue
    sendFrame(c, frame)
  }
}

// True when any socket is connected — notify.ts uses the same "no window layer → no-op" idea for WS.
export const wsHasClients = (): boolean => conns.size > 0

export type WsAuthDeps = {
  internalToken: string
  allowedHost: string
  // Resolves the device bearer at upgrade and tells the hub when a device is revoked.
  devices: DeviceService
  // How often the backstop sweep re-checks each connection's device. protocol.md § Pairing pins the
  // production value at 60s; tests inject a short one instead of faking timers.
  revocationCheckMs?: number
}

// What a successful upgrade resolved to. `deviceId` is what makes revocation actionable later: a
// socket holds no bearer to re-present, so the connection has to remember which device it belongs to.
type Authorized = { deviceId: string | null; internal?: InternalClaims }

// Upgrade auth (docs/vNext/protocol.md § Events: "token-authenticated at upgrade"): loopback Host
// guard, then a device bearer OR the internal token. Anything else → 403 before the ws handshake
// completes.
//
// There used to be a third branch — exact-Origin plus a valid session cookie — for the days when the
// renderer's socket was a browser socket on the node's own origin. The renderer loads from app://acorn
// now and every frame crosses IPC to the broker in Electron main, which presents a device bearer like
// any other client. No cookie means no Origin check either: Origin was how a cookie-bearing browser
// socket was distinguished from a cross-site one, and there is no ambient credential left to defend.
async function authorize(req: IncomingMessage, deps: WsAuthDeps): Promise<Authorized | null> {
  if (req.headers.host !== deps.allowedHost) return null
  const bearer = req.headers.authorization
  if (bearer?.startsWith('Bearer ')) {
    // A bearer that fails does NOT fall through to the internal token: presenting a credential and
    // having it rejected is a rejection, not an invitation to try the next mechanism.
    const authenticated = await deps.devices.authenticate(bearer.slice('Bearer '.length).trim())
    return authenticated ? { deviceId: authenticated.deviceId } : null
  }
  const token = req.headers['x-acorn-internal']
  // HMAC-verified, not compared with `===`. Two changes in one: the plain equality leaked the token's
  // length and a prefix-match position through timing (the HTTP path already used a constant-time
  // compare, this one did not), and INTERNAL_TOKEN is now a signing key rather than the credential
  // (server/auth/internalTokens.ts). An internal socket still gets `deviceId: null` — it has no device
  // row to revoke — but the claims are carried so a future sweep can close a task's sockets when the
  // task ends.
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
  const conn: Conn = { ws, sinks: new Map(), deviceId: authorized.deviceId, seq: 0, internal: authorized.internal }
  conns.add(conn)
  ws.on('message', (raw) => {
    let frame: WsClientFrame
    try {
      frame = JSON.parse(raw.toString()) as WsClientFrame
    } catch {
      return // non-JSON noise — ignore defensively
    }
    if (frame.channel.startsWith('term:')) {
      if (!handlers) return
      // Scope check BEFORE any handler runs. A device socket is the owner and may drive anything; an
      // internal socket may drive only the streams of the task its credential names. An unknown stream
      // id is refused for a task-scoped caller rather than allowed — failing open here would make the
      // check trivially bypassable by racing session creation.
      const streamId = (frame as { id?: unknown }).id
      if (!mayDriveStream(conn, typeof streamId === 'string' ? streamId : null)) return
      if (frame.channel === 'term:input') {
        if (typeof frame.id === 'string' && typeof frame.data === 'string') handlers.input(frame.id, frame.data)
      } else if (frame.channel === 'term:attach') {
        if (typeof frame.id !== 'string' || conn.sinks.has(frame.id)) return
        const sink: StreamSink = (msg) => sendFrame(conn, { channel: 'term:out', id: frame.id, msg })
        conn.sinks.set(frame.id, sink)
        handlers.attach(frame.id, sink) // engine restores the canonical screen before queued live frames
      } else if (frame.channel === 'term:detach') {
        const sink = conn.sinks.get(frame.id)
        if (sink) {
          handlers.detach(frame.id, sink)
          conn.sinks.delete(frame.id)
        }
      }
      return
    }
    // Every non-`term:` channel is refused outright for a task-confined socket, mirroring the posture
    // workflows' node-wide trigger-poll route takes (isTaskConfined → 403): there is no task to narrow
    // the frame to, so the only honest answer is no.
    //
    // This is not hypothetical tidying. The scope check above lived INSIDE the `term:` branch, and
    // `docker:exec:open` spawns `docker exec -it <ref> sh -c …` with `docker:exec:in` writing arbitrary
    // bytes to it — so a task-scoped credential (which an agent holds in its own environment, along with
    // the data root that names the port) got an interactive root shell in any container on the machine,
    // one directory away from the guard that exists to stop exactly that.
    //
    // A per-channel opt-in on WsChannelHandler was considered and rejected: docker browse and exec are a
    // renderer surface with no agent consumer, so the opt-in would have no takers, and the safe default
    // has to be the one a channel added later inherits.
    if (isConfined(conn)) return
    channelHandlers.get(frame.channel.split(':')[0])?.onFrame(frame, (f) => sendFrame(conn, f), conn)
  })
  const cleanup = () => {
    if (!conns.delete(conn)) return // 'error' + 'close' can both fire — run once
    for (const [id, sink] of conn.sinks) handlers?.detach(id, sink)
    conn.sinks.clear()
    for (const handler of channelHandlers.values()) handler.onDisconnect(conn)
  }
  ws.on('close', cleanup)
  ws.on('error', cleanup)
}

// Terminate every socket belonging to a revoked device. `terminate()` rather than `close()`: an
// invalidated credential must not keep a socket alive for a graceful closing handshake
// (docs/vNext/protocol.md § Pairing: "open sockets are closed, in-flight requests fail").
function dropDevice(deviceId: string): void {
  for (const conn of [...conns]) {
    if (conn.deviceId === deviceId) conn.ws.terminate()
  }
}

export function attachWsHub(server: Server, deps: WsAuthDeps): void {
  const wss = new WebSocketServer({ noServer: true })
  // Immediate path: the revoke that happened in this process tells us directly.
  const offRevoked = deps.devices.onRevoked(dropDevice)
  // Backstop for long-lived streams (protocol.md § Pairing, security.md § Transport: "re-check
  // revocation every 60s"). It covers a revoke this hub never heard about — another process, or a
  // listener registered after the revoke — which is exactly the case a live socket cannot detect,
  // since it holds no bearer to re-present.
  const sweep = setInterval(() => {
    void (async () => {
      for (const conn of [...conns]) {
        if (conn.deviceId && !(await deps.devices.isActive(conn.deviceId))) conn.ws.terminate()
      }
    })()
  }, deps.revocationCheckMs ?? 60_000)
  // A background sweep must never be the reason the process stays alive.
  sweep.unref?.()
  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    // Only claim our path — other upgrades (if any) are left for their own handlers.
    let path: string
    try {
      path = new URL(req.url ?? '', `http://${req.headers.host ?? deps.allowedHost}`).pathname
    } catch {
      socket.destroy()
      return
    }
    if (path !== WS_PATH) return
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
