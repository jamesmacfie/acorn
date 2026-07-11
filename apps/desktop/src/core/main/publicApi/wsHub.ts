import { randomUUID } from 'node:crypto'
import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { z } from 'zod'
import {
  CLOSE,
  ClientFrameSchema,
  type SubscribeFrameSchema,
} from '../../shared/publicApi/events'
import type { ApiScopes } from '../../shared/publicApi/primitives'
import type { EventBus, PublishedEvent } from './eventBus'
import type { ApiTokenPrincipal, TokenService } from '../../server/publicApi/tokenService'
import type { ServerMsg, TerminalSession } from '../../shared/terminal'
import { getStreamHandlers, type StreamSink } from '../wsHub'

// Project an engine session for the terminal.ready frame; the raw command is never sent.
function publicSession(s: TerminalSession): Record<string, unknown> {
  return {
    id: s.id, taskId: s.taskId, title: s.title, kind: s.kind, profileId: s.profileId, backend: s.backend,
    status: s.status, idle: s.idle, agentState: s.agentState, isWorktree: s.isWorktree, cwd: s.cwd,
    commandLabel: s.title, ...(s.tmuxSession ? { tmuxSession: s.tmuxSession } : {}), ...(s.repo ? { repo: s.repo } : {}),
    ...(s.pull ? { pull: s.pull } : {}), cols: s.cols, rows: s.rows, createdAt: s.createdAt, exitedAt: null, exitCode: s.exitCode,
  }
}

// Public bearer WebSocket hub (docs/next/api/events.md). Attached to the automation listener's
// 'upgrade' event so it shares the loopback listener + Host guard. Distinct from the internal
// renderer socket. Connections are indexed by token id so revocation closes them synchronously.

const WS_PATH = '/api/v1/ws'
const HEARTBEAT_MS = 30_000
const MAX_FRAME_BYTES = 1_048_576
const MAX_VIOLATIONS = 10
const VIOLATION_WINDOW_MS = 60_000

type Subscription = { subscriptionId: string; filter: z.infer<typeof SubscribeFrameSchema>['filter'] }

type Conn = {
  ws: WebSocket
  id: string
  tokenId: string
  scopes: ApiScopes
  subs: Map<string, Subscription>
  terminalSinks: Map<string, StreamSink>
  alive: boolean
  violations: number[]
}

export type PublicWsDeps = {
  tokens: TokenService
  bus: EventBus
  allowedHost: string
}

export type PublicWsHub = { close: () => void }

export function attachPublicWsHub(server: Server, deps: PublicWsDeps): PublicWsHub {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES })
  const conns = new Set<Conn>()

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = req.url ?? ''
    if (!url.startsWith(WS_PATH)) return // not ours; leave for the SPA/other hubs
    void (async () => {
      if (req.headers.host !== deps.allowedHost) return reject(socket, 403)
      const auth = req.headers.authorization
      const bearer = typeof auth === 'string' && auth.startsWith('Bearer ') && !auth.includes(',') ? auth.slice(7).trim() : undefined
      const principal = await deps.tokens.authenticate(bearer)
      if (!principal) return reject(socket, 401)
      wss.handleUpgrade(req, socket, head, (ws) => accept(ws, principal))
    })()
  }
  server.on('upgrade', onUpgrade)

  function accept(ws: WebSocket, principal: ApiTokenPrincipal) {
    const conn: Conn = { ws, id: randomUUID(), tokenId: principal.tokenId, scopes: principal.scopes, subs: new Map(), terminalSinks: new Map(), alive: true, violations: [] }
    conns.add(conn)
    send(conn, {
      type: 'ready',
      connectionId: conn.id,
      apiVersion: 'v1',
      scopes: principal.scopes as string[],
      heartbeatMs: HEARTBEAT_MS,
      maxFrameBytes: MAX_FRAME_BYTES,
    })
    ws.on('message', (raw) => onMessage(conn, raw.toString()))
    ws.on('pong', () => (conn.alive = true))
    const cleanup = () => {
      const handlers = getStreamHandlers()
      for (const [sessionId, sink] of conn.terminalSinks) handlers?.detach(sessionId, sink)
      conn.terminalSinks.clear()
      conns.delete(conn)
    }
    ws.on('close', cleanup)
    ws.on('error', cleanup)
  }

  function onMessage(conn: Conn, text: string) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return violation(conn, undefined, 'malformed_json', 'Frame is not valid JSON')
    }
    const result = ClientFrameSchema.safeParse(parsed)
    if (!result.success) {
      const reqId = typeof (parsed as { id?: unknown })?.id === 'string' ? (parsed as { id: string }).id : undefined
      return violation(conn, reqId, 'bad_frame', 'Unknown or invalid frame')
    }
    const frame = result.data
    switch (frame.type) {
      case 'ping':
        return send(conn, { type: 'pong' }, frame.id)
      case 'subscribe':
        return onSubscribe(conn, frame)
      case 'unsubscribe':
        conn.subs.delete(frame.subscriptionId)
        return ack(conn, frame.id)
      case 'terminal.attach':
        return onTerminalAttach(conn, frame.id, frame.sessionId)
      case 'terminal.detach': {
        const sink = conn.terminalSinks.get(frame.sessionId)
        if (sink) getStreamHandlers()?.detach(frame.sessionId, sink)
        conn.terminalSinks.delete(frame.sessionId)
        return ack(conn, frame.id)
      }
      case 'terminal.input': {
        if (!(conn.scopes as readonly string[]).includes('write')) return sendError(conn, frame.id, 'insufficient_scope', 'Terminal input requires the write scope')
        const handlers = getStreamHandlers()
        if (!handlers) return sendError(conn, frame.id, 'capability_unavailable', 'Terminal engine is not available')
        handlers.input(frame.sessionId, frame.data)
        return ack(conn, frame.id)
      }
    }
  }

  // Attach requires read; the sink maps engine ServerMsg → public terminal frames (ready/output/exit).
  function onTerminalAttach(conn: Conn, frameId: string, sessionId: string) {
    const handlers = getStreamHandlers()
    if (!handlers) return sendError(conn, frameId, 'capability_unavailable', 'Terminal engine is not available')
    if (conn.terminalSinks.has(sessionId)) return ack(conn, frameId)
    let seq = 0
    const sink: StreamSink = (msg: ServerMsg) => {
      if (msg.type === 'ready') send(conn, { type: 'terminal.ready', sessionId, session: publicSession(msg.session), replayedBytes: 0, truncated: false })
      else if (msg.type === 'output') send(conn, { type: 'terminal.output', sessionId, sequence: seq++, data: msg.data })
      else if (msg.type === 'exit') send(conn, { type: 'terminal.exit', sessionId, exitCode: msg.exitCode, signal: msg.signal })
      else if (msg.type === 'error') sendError(conn, undefined, msg.code, msg.message)
    }
    conn.terminalSinks.set(sessionId, sink)
    handlers.attach(sessionId, sink) // pushes ready + ring replay before live output
    ack(conn, frameId)
  }

  function onSubscribe(conn: Conn, frame: z.infer<typeof SubscribeFrameSchema>) {
    conn.subs.set(frame.subscriptionId, { subscriptionId: frame.subscriptionId, filter: frame.filter })
    // Replay before live (events.md §4): queue retained matches, then ack.
    if (frame.after !== undefined) {
      const r = deps.bus.replay(frame.after)
      if ('expired' in r) {
        return sendError(conn, frame.id, 'replay_unavailable', `Cursor predates the replay ring; oldest is ${r.oldestSequence}`)
      }
      for (const e of r.events) if (matches(frame.filter, e)) sendEvent(conn, frame.subscriptionId, e)
    }
    ack(conn, frame.id)
  }

  // Fan a published event to every connection/subscription whose filter matches.
  const unsub = deps.bus.subscribe((e) => {
    for (const conn of conns) {
      for (const sub of conn.subs.values()) if (matches(sub.filter, e)) sendEvent(conn, sub.subscriptionId, e)
    }
  })

  // Close a revoked token's sockets synchronously (authentication.md §6).
  const unRevoke = deps.tokens.onRevoked((tokenId) => {
    for (const conn of conns) if (conn.tokenId === tokenId) conn.ws.close(CLOSE.tokenRevoked, 'token revoked')
  })

  const heartbeat = setInterval(() => {
    for (const conn of conns) {
      if (!conn.alive) {
        conn.ws.close(CLOSE.slowConsumer, 'heartbeat timeout')
        continue
      }
      conn.alive = false
      try {
        conn.ws.ping()
      } catch {
        conns.delete(conn)
      }
    }
  }, HEARTBEAT_MS)

  function violation(conn: Conn, requestId: string | undefined, code: string, message: string) {
    sendError(conn, requestId, code, message)
    const now = Date.now()
    conn.violations = conn.violations.filter((t) => now - t < VIOLATION_WINDOW_MS)
    conn.violations.push(now)
    if (conn.violations.length >= MAX_VIOLATIONS) conn.ws.close(CLOSE.invalidProtocol, 'too many invalid frames')
  }

  function send(conn: Conn, body: Record<string, unknown>, id?: string) {
    if (conn.ws.readyState !== conn.ws.OPEN) return
    conn.ws.send(JSON.stringify({ version: 1, id: id ?? randomUUID(), at: Date.now(), ...body }))
  }
  const ack = (conn: Conn, requestId: string) => send(conn, { type: 'ack', requestId }, requestId)
  const sendError = (conn: Conn, requestId: string | undefined, code: string, message: string) =>
    send(conn, { type: 'error', ...(requestId ? { requestId } : {}), error: { code, message } })
  const sendEvent = (conn: Conn, subscriptionId: string, e: PublishedEvent) =>
    send(conn, { type: 'event', subscriptionId, sequence: e.sequence, channel: e.channel, actor: e.actor, ...(e.resource ? { resource: e.resource } : {}), data: e.data })

  return {
    close: () => {
      clearInterval(heartbeat)
      unsub()
      unRevoke()
      server.off('upgrade', onUpgrade)
      for (const conn of conns) conn.ws.close(CLOSE.shuttingDown, 'shutting down')
      wss.close()
    },
  }
}

function reject(socket: Duplex, status: 401 | 403): void {
  const text = status === 401 ? 'Unauthorized' : 'Forbidden'
  socket.write(`HTTP/1.1 ${status} ${text}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

// A published event matches a subscription filter when its channel is listed (exact or `prefix.*`)
// and any task/workspace narrowing is satisfied.
function matches(filter: Subscription['filter'], e: PublishedEvent): boolean {
  const channelOk = filter.channels.some((c) => c === e.channel || (c.endsWith('.*') && e.channel.startsWith(c.slice(0, -1))))
  if (!channelOk) return false
  if (filter.taskIds && (e.taskId === undefined || !filter.taskIds.includes(e.taskId))) return false
  if (filter.workspaceIds && (e.workspaceId === undefined || !filter.workspaceIds.includes(e.workspaceId))) return false
  return true
}
