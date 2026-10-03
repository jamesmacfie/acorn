import { connect, type Socket } from 'node:net'
import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { claimUpgrade } from './upgradeClaim'
import { authorizeWsUpgrade, type WsAuthDeps } from './wsHub'
import { MAX_TUNNEL_MESSAGE_BYTES } from '@acorn/protocol/ws.ts'

export type TunnelDeps = WsAuthDeps & {
  // Ports this task legitimately serves on (docs/api-reference/websocket.md § WebSocket). Empty, or a throw,
  // means nothing is tunnellable for that task.
  declaredPorts(taskId: string): Promise<readonly number[]>
  maxTunnelMessageBytes?: number
}

export const TUNNEL_PATH = '/v1/tunnel'

// 127.0.0.1 only, never the hostname (docs/api-reference/websocket.md § WebSocket, on why there is no general
// SOCKS proxy here).
const LOOPBACK = '127.0.0.1'

const tunnelDisposers = new WeakMap<Server, () => void>()

type Target = { taskId: string; port: number }

// `?task=<uuid>&port=<n>`. A query rather than a path segment, so the path stays a constant the
// upgrade handler matches with `===`, the shape wsHub uses.
function parseTarget(url: string | undefined, host: string): Target | null {
  let parsed: URL
  try {
    parsed = new URL(url ?? '', `http://${host}`)
  } catch {
    return null
  }
  if (parsed.pathname !== TUNNEL_PATH) return null
  const taskId = parsed.searchParams.get('task')
  const port = Number(parsed.searchParams.get('port'))
  if (!taskId || !Number.isInteger(port) || port < 1 || port > 65535) return null
  return { taskId, port }
}

// Refusing has to survive a peer that has already gone away.
//
// Between `claimUpgrade` and the refusal the handler awaits a device lookup and the port resolver,
// which reads the tasks table, the project config row, and possibly a `url_command`. A client that
// connects and immediately RSTs leaves a destroyed socket, and `write` on one emits an `'error'` the
// HTTP server no longer listens for, having handed the socket over. That becomes an
// `uncaughtException`, so a loop of half-open upgrades is a remote denial of service.
const refuse = (socket: Duplex, status: number, reason: string): void => {
  if (!socket.destroyed && socket.writable) {
    try { socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`, () => socket.destroy()) } catch { socket.destroy() }
  } else socket.destroy()
}

// Pipe a WebSocket and a TCP socket into each other. Binary both ways, because a dev server's bytes
// are not text and without `binaryType` set `ws` hands them over as string fragments and corrupts
// anything non-UTF8.
//
// Flow control runs in both directions, and it has to block rather than drop the way the events hub
// does. A dropped frame there costs a client a `seq` gap and a refetch. Dropped bytes here corrupt a
// TCP stream with no way to notice.
function bridge(ws: WebSocket, tcp: Socket, maxBytes: number): void {
  ws.binaryType = 'nodebuffer'
  let closed = false
  const closeBoth = (): void => {
    if (closed) return
    closed = true
    tcp.destroy()
    if (ws.readyState === ws.OPEN) ws.close()
  }

  // client to node. `write` returning false is TCP backpressure, and pausing the WebSocket stops
  // `ws` reading, which closes the kernel window back to the client.
  ws.on('message', (data: Buffer) => {
    try { if (!tcp.write(data)) ws.pause() } catch { closeBoth() }
  })
  tcp.on('drain', () => { if (!closed) ws.resume() })

  // node to client. `ws.send`'s callback fires once the frame reaches the socket, so it is the drain
  // signal. No polling on `bufferedAmount`, and no unbounded queue here when the LAN link is slower
  // than the dev server.
  tcp.on('data', (chunk: Buffer) => {
    tcp.pause()
    let offset = 0
    const next = (): void => {
      if (closed || ws.readyState !== ws.OPEN) return closeBoth()
      if (offset === chunk.length) { tcp.resume(); return }
      const end = Math.min(offset + maxBytes, chunk.length)
      const part = chunk.subarray(offset, end)
      offset = end
      try { ws.send(part, (error) => { if (error) closeBoth(); else next() }) } catch { closeBoth() }
    }
    next()
  })

  ws.on('close', closeBoth)
  ws.on('error', closeBoth)
  tcp.on('close', closeBoth)
  tcp.on('error', closeBoth)
}

// A live pipe, remembered so revocation can tear it down. Like `wsHub`'s `Conn`, it carries a
// deviceId, because a socket holds no bearer to re-present.
type Pipe = { ws: WebSocket; tcp: Socket; deviceId: string | null }

export function attachTunnel(server: Server, deps: TunnelDeps): void {
  const maxBytes = Math.min(deps.maxTunnelMessageBytes ?? MAX_TUNNEL_MESSAGE_BYTES, MAX_TUNNEL_MESSAGE_BYTES)
  const wss = new WebSocketServer({ noServer: true, maxPayload: maxBytes })
  const pipes = new Set<Pipe>()
  const pending = new Map<Duplex, Socket | null>()
  let disposed = false
  const ready = (socket: Duplex): boolean => !disposed && !socket.destroyed && socket.writable

  const closePipe = (pipe: Pipe): void => {
    pipes.delete(pipe)
    pipe.tcp.destroy()
    pipe.ws.terminate() // terminate, not close, so an invalidated credential cannot survive a handshake
  }
  const offRevoked = deps.devices.onRevoked((deviceId) => {
    for (const pipe of [...pipes]) if (pipe.deviceId === deviceId) closePipe(pipe)
  })
  // The backstop, for a revoke this process never heard about. Same interval and injection point as
  // wsHub's.
  const sweep = setInterval(() => {
    void (async () => {
      for (const pipe of [...pipes]) {
        if (pipe.deviceId && !(await deps.devices.isActive(pipe.deviceId).catch(() => false))) closePipe(pipe)
      }
    })()
  }, deps.revocationCheckMs ?? 60_000)
  sweep.unref?.()

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    // Parsing only; authorizeWsUpgrade below is what checks the Host against the allowlist.
    const host = req.headers.host ?? 'placeholder.invalid'
    const target = parseTarget(req.url, host)
    // Claim only our own path, leaving `/v1/events` and anything later to its own handler, the same
    // contract wsHub's handler keeps.
    if (!target) return
    // Synchronously, because the sweeper in server/transport/upgradeClaim.ts cannot await our auth.
    claimUpgrade(socket)
    pending.set(socket, null)
    const onPeerError = (): void => { socket.destroy() }
    socket.on('error', onPeerError)
    socket.once('close', () => { pending.get(socket)?.destroy(); pending.delete(socket) })
    void (async () => {
      const authorized = await authorizeWsUpgrade(req, deps)
      if (!ready(socket)) { socket.destroy(); return }
      if (!authorized) return refuse(socket, 403, 'Forbidden')
      const claims = authorized.internal
      if (claims?.scope === 'task' && claims.taskId !== target.taskId) return refuse(socket, 403, 'Forbidden')

      // A throw means the same as an empty list: nothing is tunnellable.
      const ports: readonly number[] = await deps.declaredPorts(target.taskId).catch(() => [] as number[])
      if (!ready(socket)) { socket.destroy(); return }
      if (!ports.includes(target.port)) return refuse(socket, 403, 'Forbidden')

      const tcp = connect({ host: LOOPBACK, port: target.port })
      pending.set(socket, tcp)
      // The listener stays attached through the handshake. Clearing it on connect leaves a window
      // with no error listener, so a dev server that resets between `connect` and the upgrade write
      // emits an unhandled `'error'` that takes the process down.
      let handedOver = false
      tcp.on('error', () => {
        if (!handedOver) refuse(socket, 502, 'Bad Gateway')
        tcp.destroy()
      })
      tcp.once('close', () => { if (!handedOver && ready(socket)) refuse(socket, 502, 'Bad Gateway') })
      tcp.once('connect', () => {
        if (!ready(socket)) { tcp.destroy(); socket.destroy(); return }
        try {
          wss.handleUpgrade(req, socket, head, (ws) => {
            if (disposed || tcp.destroyed) { ws.on('error', () => {}); ws.terminate(); tcp.destroy(); return }
            handedOver = true
            pending.delete(socket)
            const pipe: Pipe = { ws, tcp, deviceId: authorized.deviceId }
            pipes.add(pipe)
            ws.on('close', () => pipes.delete(pipe))
            bridge(ws, tcp, maxBytes)
            socket.off('error', onPeerError)
          })
        } catch {
          tcp.destroy()
          refuse(socket, 502, 'Bad Gateway')
        }
      })
    })().catch(() => refuse(socket, 403, 'Forbidden'))
  }

  server.on('upgrade', onUpgrade)
  tunnelDisposers.set(server, () => {
    disposed = true
    server.off('upgrade', onUpgrade)
    clearInterval(sweep)
    offRevoked()
    for (const [socket, tcp] of pending) { tcp?.destroy(); socket.destroy() }
    pending.clear()
    for (const pipe of [...pipes]) closePipe(pipe)
    wss.close()
  })
}

export function disposeTunnel(server: Server): void {
  tunnelDisposers.get(server)?.()
  tunnelDisposers.delete(server)
}
