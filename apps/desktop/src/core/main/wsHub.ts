// The single authenticated WebSocket hub (docs/electron.md §12): one socket on the loopback
// origin carries every live stream (shared/ws.ts). It lives in the utility service beside the
// PTY engine; terminal.ts registers the stream handlers, notify.ts broadcasts the
// pings through it. Attached to the @hono/node-server http.Server's 'upgrade' event so it shares
// the loopback listener and its Host guard.
import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { openSession, SESSION_COOKIE } from '../server/session'
import type { ServerMsg } from '@acorn/protocol/terminal.ts'
import { WS_PATH, type WsClientFrame, type WsServerFrame } from '@acorn/protocol/ws.ts'

// A sink is one connection's outlet for a session's ServerMsg frames — terminal.ts adds/removes it
// from a session's subscriber set on attach/detach and calls it to push output.
export type StreamSink = (msg: ServerMsg) => void

// The engine handlers the hub routes client frames to (registered by terminal.ts). attach registers
// the sink synchronously; the terminal engine owns canonical-snapshot-before-live ordering.
export type StreamHandlers = {
  input(id: string, data: string): void
  attach(id: string, sink: StreamSink): void
  detach(id: string, sink: StreamSink): void
}

let handlers: StreamHandlers | null = null
export const setStreamHandlers = (h: StreamHandlers | null): void => void (handlers = h)
// The public WS hub reuses the same engine stream handlers to serve terminal.attach/input/output.
export const getStreamHandlers = (): StreamHandlers | null => handlers

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

type Conn = { ws: WebSocket; sinks: Map<string, StreamSink> }
const conns = new Set<Conn>()
const hubDisposers = new WeakMap<Server, () => void>()

function sendFrame(ws: WebSocket, frame: WsServerFrame): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame))
}

// Session-status pings + workflow notices go to every open socket (notify.ts). Sessions' own output
// goes only to attached sockets, via their per-session sink.
export function wsBroadcast(frame: WsServerFrame): void {
  for (const c of conns) sendFrame(c.ws, frame)
}

// True when any socket is connected — notify.ts uses the same "no window layer → no-op" idea for WS.
export const wsHasClients = (): boolean => conns.size > 0

export type WsAuthDeps = { encKey: string; internalToken: string; allowedHost: string; origin: string }

// Upgrade auth (security.md §3/§7): loopback Host guard + exact-Origin + a valid session cookie, OR
// the internal token (the loopback MCP caller — no cookie/origin). Anything else → 403 before the
// ws handshake completes.
async function authorize(req: IncomingMessage, deps: WsAuthDeps): Promise<boolean> {
  if (req.headers.host !== deps.allowedHost) return false
  const token = req.headers['x-acorn-internal']
  if (typeof token === 'string' && token && token === deps.internalToken) return true
  if (req.headers.origin !== deps.origin) return false // a browser socket must carry the exact origin
  const cookie = readCookie(req.headers.cookie, SESSION_COOKIE)
  if (!cookie) return false
  return (await openSession(cookie, deps.encKey)) != null
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return null
}

function onConnect(ws: WebSocket): void {
  const conn: Conn = { ws, sinks: new Map() }
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
      if (frame.channel === 'term:input') {
        if (typeof frame.id === 'string' && typeof frame.data === 'string') handlers.input(frame.id, frame.data)
      } else if (frame.channel === 'term:attach') {
        if (typeof frame.id !== 'string' || conn.sinks.has(frame.id)) return
        const sink: StreamSink = (msg) => sendFrame(ws, { channel: 'term:out', id: frame.id, msg })
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
    channelHandlers.get(frame.channel.split(':')[0])?.onFrame(frame, (f) => sendFrame(ws, f), conn)
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

export function attachWsHub(server: Server, deps: WsAuthDeps): void {
  const wss = new WebSocketServer({ noServer: true })
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
    void authorize(req, deps).then((ok) => {
      if (!ok) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => onConnect(ws))
    })
  }
  server.on('upgrade', onUpgrade)
  hubDisposers.set(server, () => {
    server.off('upgrade', onUpgrade)
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
