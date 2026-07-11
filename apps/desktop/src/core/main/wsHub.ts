// The single authenticated WebSocket hub (docs/electron.md §12): one socket on the loopback
// origin carries every live stream (shared/ws.ts). It lives in main because the streams it serves
// belong to the PTY engine; terminal.ts registers the stream handlers, notify.ts broadcasts the
// pings through it. Attached to the @hono/node-server http.Server's 'upgrade' event so it shares
// the loopback listener and its Host guard.
import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { openSession, SESSION_COOKIE } from '../server/session'
import type { ServerMsg } from '../shared/terminal'
import { WS_PATH, type WsClientFrame, type WsServerFrame } from '../shared/ws'

// A sink is one connection's outlet for a session's ServerMsg frames — terminal.ts adds/removes it
// from a session's subscriber set on attach/detach and calls it to push output.
export type StreamSink = (msg: ServerMsg) => void

// The engine handlers the hub routes client frames to (registered by terminal.ts). attach is
// synchronous and MUST push ready + ring replay to the sink before any live frame — the hub relies
// on that for deterministic replay-before-live ordering.
export type StreamHandlers = {
  input(id: string, data: string): void
  attach(id: string, sink: StreamSink): void
  detach(id: string, sink: StreamSink): void
}

let handlers: StreamHandlers | null = null
export const setStreamHandlers = (h: StreamHandlers | null): void => void (handlers = h)
// The public WS hub reuses the same engine stream handlers to serve terminal.attach/input/output.
export const getStreamHandlers = (): StreamHandlers | null => handlers

// The UI control broker (docs/next/api §3.4). Set by the composition root; the renderer's ui:*
// frames route to it and it sends ui:command frames back over this socket.
let broker: import('./publicApi/uiControlBroker').UiControlBroker | null = null
export const setUiBroker = (b: import('./publicApi/uiControlBroker').UiControlBroker | null): void => void (broker = b)

type Conn = { ws: WebSocket; sinks: Map<string, StreamSink>; windowId?: string }
const conns = new Set<Conn>()

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
    // UI control broker frames (renderer registration + command results). Independent of stream handlers.
    if (frame.channel === 'ui:register') {
      conn.windowId = frame.windowId
      broker?.register(frame.windowId, frame.primary, frame.snapshot, (cmd) => sendFrame(ws, cmd))
      return
    }
    if (frame.channel === 'ui:state') {
      broker?.updateState(frame.windowId, frame.snapshot)
      return
    }
    if (frame.channel === 'ui:command-result') {
      broker?.resolveResult(frame)
      return
    }
    if (!handlers) return
    if (frame.channel === 'term:input') {
      if (typeof frame.id === 'string' && typeof frame.data === 'string') handlers.input(frame.id, frame.data)
    } else if (frame.channel === 'term:attach') {
      if (typeof frame.id !== 'string' || conn.sinks.has(frame.id)) return
      const sink: StreamSink = (msg) => sendFrame(ws, { channel: 'term:out', id: frame.id, msg })
      conn.sinks.set(frame.id, sink)
      handlers.attach(frame.id, sink) // pushes ready + ring replay synchronously, before any live frame
    } else if (frame.channel === 'term:detach') {
      const sink = conn.sinks.get(frame.id)
      if (sink) {
        handlers.detach(frame.id, sink)
        conn.sinks.delete(frame.id)
      }
    }
  })
  const cleanup = () => {
    for (const [id, sink] of conn.sinks) handlers?.detach(id, sink)
    conn.sinks.clear()
    if (conn.windowId) broker?.disconnect(conn.windowId)
    conns.delete(conn)
  }
  ws.on('close', cleanup)
  ws.on('error', cleanup)
}

export function attachWsHub(server: Server, deps: WsAuthDeps): void {
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
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
  })
}

// Test-only reset so the module singleton doesn't leak connections between cases.
export function _resetWsHub(): void {
  for (const c of conns) c.ws.close()
  conns.clear()
  handlers = null
}
