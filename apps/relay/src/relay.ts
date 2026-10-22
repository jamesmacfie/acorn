import { randomBytes } from 'node:crypto'
import { createServer as createHttpServer, STATUS_CODES, type IncomingMessage } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { pipeline, type Duplex } from 'node:stream'
import { createWebSocketStream, WebSocketServer, type WebSocket } from 'ws'
import {
  RELAY_MAX_MESSAGE_BYTES,
  RELAY_PING_INTERVAL_MS,
  RELAY_REPLACED,
  RELAY_REVOKED,
  relayControlMessageSchema,
  relayRouteIdSchema,
  relayStreamIdSchema,
  relayStreamKindSchema,
} from '@acorn/protocol/relay.ts'
import { staticAuth, type NodeGrant, type RelayAuth } from './auth'

// It joins a client's stream to a Node's and forwards the bytes without reading them. Who may do
// that is `RelayAuth`: one static credential in self-hosted mode, or an account service's tickets and
// Node credentials. PROTOCOL.md beside this package is the wire format.

const ACCEPT_TIMEOUT_MS = 10_000
const MAX_STREAMS_PER_ROUTE = 256

export type RelayOptions = {
  /** Who may connect: a static credential, or an account service's keys. */
  auth: RelayAuth | string
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
// `streams` holds both ends of every stream joined through this registration, so they close with it.
type Registration = { control: WebSocket; waiting: Map<string, Waiting>; grant: NodeGrant; streams: Set<WebSocket> }

export async function startRelay(options: RelayOptions): Promise<Relay> {
  const log = options.log ?? (() => {})
  const acceptTimeoutMs = options.acceptTimeoutMs ?? ACCEPT_TIMEOUT_MS
  const auth = typeof options.auth === 'string' ? staticAuth(options.auth) : options.auth
  const registrations = new Map<string, Registration>()
  const streamCounts = new Map<string, number>()
  const wss = new WebSocketServer({ noServer: true, maxPayload: RELAY_MAX_MESSAGE_BYTES, perMessageDeflate: false })
  const server = options.tls ? createHttpsServer(options.tls) : createHttpServer()

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

  function register(route: string, grant: NodeGrant, request: IncomingMessage, socket: Duplex, head: Buffer): void {
    upgrade(request, socket, head, (control) => {
      const previous = registrations.get(route)
      if (previous) {
        log(`route ${route} replaced by a newer connection`)
        previous.control.close(RELAY_REPLACED, 'replaced')
      }
      const registration: Registration = { control, waiting: new Map(), grant, streams: new Set() }
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
        // A stream outlives nothing: with its Node gone from the relay, whether it left, was replaced, or
        // was revoked, the clients on it lose the Node too.
        for (const stream of registration.streams) stream.close(1001)
      })
    })
  }

  function connect(
    route: string,
    account: string | undefined,
    kind: string,
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    const registration = registrations.get(route)
    if (!registration) return answer(socket, 404)
    // A ticket names the account it was issued to, and only that account's Node takes its streams.
    if (account !== undefined && registration.grant.owner !== account) return answer(socket, 401)
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
          join(route, registration, upgraded, node)
        })
      },
    })
    registration.control.send(JSON.stringify({ type: 'stream', id, kind }))
  }

  function accept(
    route: string,
    grant: NodeGrant,
    id: string,
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    const registration = registrations.get(route)
    // The stream is offered to the connection that registered, so only its credential may answer.
    if (registration && registration.grant.credentialId !== grant.credentialId) return answer(socket, 401)
    const waiting = registration?.waiting.get(id)
    if (!waiting) return answer(socket, 404)
    upgrade(request, socket, head, (node) => waiting.join(node))
  }

  // Bytes go across unchanged, with backpressure, and either end closing closes the other.
  function join(route: string, registration: Registration, client: WebSocket, node: WebSocket): void {
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
      registration.streams.add(end)
      end.once('close', () => registration.streams.delete(end))
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
  server.on('upgrade', async (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => socket.destroy())
    const url = new URL(request.url ?? '/', 'http://relay')
    const nodeMatch = /^\/v1\/nodes\/([^/]+)$/.exec(url.pathname)
    const acceptMatch = /^\/v1\/nodes\/([^/]+)\/streams\/([^/]+)$/.exec(url.pathname)
    const connectMatch = /^\/v1\/connect\/([^/]+)$/.exec(url.pathname)
    const route = (nodeMatch ?? acceptMatch ?? connectMatch)?.[1] ?? ''
    if (!nodeMatch && !acceptMatch && !connectMatch) return answer(socket, 404)
    if (!relayRouteIdSchema.safeParse(route).success) return answer(socket, 400)
    const kind = url.searchParams.get('kind') ?? ''
    if (connectMatch && !relayStreamKindSchema.safeParse(kind).success) return answer(socket, 400)
    if (acceptMatch && !relayStreamIdSchema.safeParse(acceptMatch[2]).success) return answer(socket, 400)
    // The account service's keys decide, which can take a moment, and a failure to check is a refusal.
    const refused = (): null => null
    if (connectMatch) {
      const grant = await auth.client(request, route).catch(refused)
      return grant ? connect(route, grant.account, kind, request, socket, head) : answer(socket, 401)
    }
    const grant = await auth.node(request, route).catch(refused)
    if (!grant) return answer(socket, 401)
    if (acceptMatch) return accept(route, grant, acceptMatch[2]!, request, socket, head)
    register(route, grant, request, socket, head)
  })

  // A credential the account service revoked has no more business here than a closed account.
  auth.watch?.((credentialId) => {
    for (const registration of registrations.values())
      if (registration.grant.credentialId === credentialId) registration.control.close(RELAY_REVOKED, 'revoked')
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
        auth.close?.()
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
