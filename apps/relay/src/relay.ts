import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer as createHttpServer, STATUS_CODES, type IncomingMessage } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { pipeline, type Duplex } from 'node:stream'
import { createWebSocketStream, WebSocketServer, type WebSocket } from 'ws'
import {
  RELAY_MAX_MESSAGE_BYTES,
  RELAY_PING_INTERVAL_MS,
  RELAY_REPLACED,
  relayControlMessageSchema,
  relayRouteIdSchema,
  relayStreamIdSchema,
  relayStreamKindSchema,
} from '@acorn/protocol/relay.ts'

// A relay in self-hosted mode: one static credential, held by the owner's Nodes and clients alike.
// It joins a client's stream to a Node's and forwards the bytes without reading them. PROTOCOL.md
// beside this package is the wire format.

const ACCEPT_TIMEOUT_MS = 10_000
const MAX_STREAMS_PER_ROUTE = 256

export type RelayOptions = {
  credential: string
  port?: number
  host?: string
  // Serve wss:// directly. Without it the relay speaks ws://, for a proxy that terminates TLS.
  tls?: { cert: string; key: string }
  log?: (line: string) => void
  // How long a client waits for the Node to open its end. Shortened by tests.
  acceptTimeoutMs?: number
}

export type Relay = { port: number; close(): Promise<void> }

// A client's upgrade, held until the Node opens its end of the stream.
type Waiting = { join(node: WebSocket): void; refuse(status: number): void }
type Registration = { control: WebSocket; waiting: Map<string, Waiting> }

export async function startRelay(options: RelayOptions): Promise<Relay> {
  const log = options.log ?? (() => {})
  const acceptTimeoutMs = options.acceptTimeoutMs ?? ACCEPT_TIMEOUT_MS
  const credential = Buffer.from(`Bearer ${options.credential}`)
  const registrations = new Map<string, Registration>()
  const streamCounts = new Map<string, number>()
  const wss = new WebSocketServer({ noServer: true, maxPayload: RELAY_MAX_MESSAGE_BYTES, perMessageDeflate: false })
  const server = options.tls ? createHttpsServer(options.tls) : createHttpServer()

  const authorized = (request: IncomingMessage): boolean => {
    const presented = Buffer.from(request.headers.authorization ?? '')
    return presented.length === credential.length && timingSafeEqual(presented, credential)
  }

  // Every upgrade goes through here, so every connection is pinged and none can throw an unhandled
  // 'error', such as an oversized message, at the process.
  const answered = new WeakSet<WebSocket>()
  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer, done: (ws: WebSocket) => void): void =>
    wss.handleUpgrade(request, socket, head, (ws) => {
      answered.add(ws)
      ws.on('pong', () => answered.add(ws))
      ws.on('error', () => ws.terminate())
      done(ws)
    })

  const countStream = (route: string, change: 1 | -1): void => {
    const count = (streamCounts.get(route) ?? 0) + change
    if (count > 0) streamCounts.set(route, count)
    else streamCounts.delete(route)
  }

  function register(route: string, request: IncomingMessage, socket: Duplex, head: Buffer): void {
    upgrade(request, socket, head, (control) => {
      const previous = registrations.get(route)
      if (previous) {
        log(`route ${route} replaced by a newer connection`)
        previous.control.close(RELAY_REPLACED, 'replaced')
      }
      const registration: Registration = { control, waiting: new Map() }
      registrations.set(route, registration)
      log(`route ${route} connected`)
      control.on('message', (data, isBinary) => {
        if (isBinary) return
        const message = relayControlMessageSchema.safeParse(parseJson(data.toString()))
        if (message.success && message.data.type === 'refuse') registration.waiting.get(message.data.id)?.refuse(502)
      })
      control.on('close', () => {
        if (registrations.get(route) === registration) {
          registrations.delete(route)
          log(`route ${route} disconnected`)
        }
        for (const waiting of registration.waiting.values()) waiting.refuse(502)
      })
    })
  }

  function connect(route: string, kind: string, request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const registration = registrations.get(route)
    if (!registration) return answer(socket, 404)
    if ((streamCounts.get(route) ?? 0) >= MAX_STREAMS_PER_ROUTE) return answer(socket, 503)
    const id = randomBytes(16).toString('hex')
    countStream(route, 1)
    let settled = false
    const settle = (): boolean => {
      if (settled) return false
      settled = true
      clearTimeout(timer)
      socket.off('close', gaveUp)
      registration.waiting.delete(id)
      return true
    }
    const refuse = (status: number): void => {
      if (!settle()) return
      countStream(route, -1)
      answer(socket, status)
    }
    const gaveUp = (): void => {
      if (settle()) countStream(route, -1)
    }
    const timer = setTimeout(() => refuse(504), acceptTimeoutMs)
    socket.once('close', gaveUp)
    registration.waiting.set(id, {
      refuse,
      join(node) {
        if (!settle()) return node.close(1011)
        let client: WebSocket | undefined
        // ws destroys a socket whose handshake it rejects, and then never calls back.
        const abandoned = (): void => {
          if (!client) node.close(1011)
        }
        socket.once('close', abandoned)
        upgrade(request, socket, head, (upgraded) => {
          client = upgraded
          socket.off('close', abandoned)
          join(route, upgraded, node)
        })
      },
    })
    registration.control.send(JSON.stringify({ type: 'stream', id, kind }))
  }

  function accept(route: string, id: string, request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const waiting = registrations.get(route)?.waiting.get(id)
    if (!waiting) return answer(socket, 404)
    upgrade(request, socket, head, (node) => waiting.join(node))
  }

  // Bytes go across unchanged, with backpressure, and either end closing closes the other.
  function join(route: string, client: WebSocket, node: WebSocket): void {
    let open = true
    const close = (code: number): void => {
      client.close(code)
      node.close(code)
    }
    const release = (): void => {
      if (!open) return
      open = false
      countStream(route, -1)
    }
    for (const end of [client, node]) {
      end.once('close', release)
      end.on('message', (_data, isBinary) => {
        if (!isBinary) close(1003)
      })
    }
    const clientBytes = createWebSocketStream(client)
    const nodeBytes = createWebSocketStream(node)
    pipeline(clientBytes, nodeBytes, () => {})
    pipeline(nodeBytes, clientBytes, () => {})
  }

  server.on('request', (_request, response) => response.writeHead(426, { connection: 'close' }).end())
  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => socket.destroy())
    const url = new URL(request.url ?? '/', 'http://relay')
    const nodeMatch = /^\/v1\/nodes\/([^/]+)$/.exec(url.pathname)
    const acceptMatch = /^\/v1\/nodes\/([^/]+)\/streams\/([^/]+)$/.exec(url.pathname)
    const connectMatch = /^\/v1\/connect\/([^/]+)$/.exec(url.pathname)
    const route = (nodeMatch ?? acceptMatch ?? connectMatch)?.[1] ?? ''
    if (!nodeMatch && !acceptMatch && !connectMatch) return answer(socket, 404)
    if (!relayRouteIdSchema.safeParse(route).success) return answer(socket, 400)
    if (!authorized(request)) return answer(socket, 401)
    if (nodeMatch) return register(route, request, socket, head)
    if (acceptMatch) {
      const id = acceptMatch[2]!
      if (!relayStreamIdSchema.safeParse(id).success) return answer(socket, 400)
      return accept(route, id, request, socket, head)
    }
    const kind = url.searchParams.get('kind') ?? ''
    if (!relayStreamKindSchema.safeParse(kind).success) return answer(socket, 400)
    connect(route, kind, request, socket, head)
  })

  // A connection that didn't answer the last ping is gone, whatever its socket thinks.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!answered.delete(ws)) ws.terminate()
      else ws.ping()
    }
  }, RELAY_PING_INTERVAL_MS)
  heartbeat.unref()

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise((resolve) => {
        clearInterval(heartbeat)
        for (const registration of registrations.values())
          for (const waiting of registration.waiting.values()) waiting.refuse(503)
        for (const ws of wss.clients) ws.terminate()
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}

// An HTTP answer in place of the upgrade, then the socket closes.
function answer(socket: Duplex, status: number): void {
  if (socket.destroyed) return
  socket.once('finish', () => socket.destroy())
  socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ''}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
