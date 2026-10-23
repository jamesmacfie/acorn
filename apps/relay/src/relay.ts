import { randomBytes } from 'node:crypto'
import { createServer as createHttpServer, STATUS_CODES, type IncomingMessage } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { createServer as createTcpServer, type AddressInfo, type Server as TcpServer, type Socket } from 'node:net'
import { pipeline, type Duplex } from 'node:stream'
import { createWebSocketStream, WebSocketServer, type WebSocket } from 'ws'
import {
  RELAY_MAX_MESSAGE_BYTES,
  RELAY_PING_INTERVAL_MS,
  RELAY_PREVIEW_STREAM,
  RELAY_REPLACED,
  RELAY_REVOKED,
  RELAY_SUBPROTOCOL,
  parsePreviewName,
  previewNodeLabel,
  relayControlMessageSchema,
  relayRouteIdSchema,
  relayStreamIdSchema,
  relayStreamKindSchema,
} from '@acorn/protocol/relay.ts'
import { staticAuth, type NodeGrant, type RelayAuth } from './auth'
import { readClientHello } from './clientHello'

// It joins a client's stream to a Node's and forwards the bytes without reading them. Who may do
// that is `RelayAuth`: one static credential in self-hosted mode, or an account service's tickets and
// Node credentials. PROTOCOL.md beside this package is the wire format.
//
// With a preview domain it also takes browsers' TLS connections on that domain, reads the server name
// from the ClientHello, and hands the bytes to the Node that name belongs to. The Node ends the TLS, so
// the relay holds no certificate and sees ciphertext after the first record.

const ACCEPT_TIMEOUT_MS = 10_000
const MAX_STREAMS_PER_ROUTE = 256
// Anyone who knows a preview name can open one of these, so they have a limit of their own and can't
// use up the streams a phone's channel needs.
const MAX_PREVIEW_STREAMS_PER_ROUTE = 32
const CLIENT_HELLO_TIMEOUT_MS = 10_000

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
  // Take TLS connections for names under this domain, a host name with no port, and pass them to the
  // Node the name belongs to (PROTOCOL.md § Preview streams).
  preview?: { domain: string; port?: number; host?: string }
}

export type Relay = { port: number; previewPort?: number; close(): Promise<void> }

// A client's stream, held until the Node opens its end of it.
type Waiting = { join(node: WebSocket): void; refuse(status: number): void }
// The client's end of a stream the relay asked a Node for: a WebSocket upgrade it holds, or a TLS
// connection to the preview listener. `socket` closing before the Node answers means the client gave up.
type ClientEnd = { socket: Duplex; refuse(status: number): void; join(node: WebSocket): void }
// `streams` holds the Node's end of every stream joined through this registration, and a client's WebSocket
// end too, so they close with it.
type Registration = { control: WebSocket; waiting: Map<string, Waiting>; grant: NodeGrant; streams: Set<WebSocket> }

// How many streams one route has open or waiting, against a limit.
function streamCounter(max: number) {
  const counts = new Map<string, number>()
  return {
    full: (route: string): boolean => (counts.get(route) ?? 0) >= max,
    count(route: string, change: 1 | -1): void {
      const count = (counts.get(route) ?? 0) + change
      if (count > 0) counts.set(route, count)
      else counts.delete(route)
    },
  }
}
type StreamCounter = ReturnType<typeof streamCounter>

export async function startRelay(options: RelayOptions): Promise<Relay> {
  const log = options.log ?? (() => {})
  const acceptTimeoutMs = options.acceptTimeoutMs ?? ACCEPT_TIMEOUT_MS
  const auth = typeof options.auth === 'string' ? staticAuth(options.auth) : options.auth
  const registrations = new Map<string, Registration>()
  // A preview name carries a Node's label, so the relay keeps the route each connected Node's label stands for.
  const previewRoutes = new Map<string, string>()
  const streams = streamCounter(MAX_STREAMS_PER_ROUTE)
  const previews = streamCounter(MAX_PREVIEW_STREAMS_PER_ROUTE)
  const previewSockets = new Set<Socket>()
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: RELAY_MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
    // A browser offers the relay's name and its ticket as subprotocols. Only the name is selected, so the
    // ticket is never echoed back.
    handleProtocols: (protocols) => (protocols.has(RELAY_SUBPROTOCOL) ? RELAY_SUBPROTOCOL : false),
  })
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

  function register(
    route: string,
    grant: NodeGrant,
    label: string | undefined,
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    upgrade(request, socket, head, (control) => {
      const previous = registrations.get(route)
      if (previous) {
        log(`route ${route} replaced by a newer connection`)
        previous.control.close(RELAY_REPLACED, 'replaced')
      }
      const registration: Registration = { control, waiting: new Map(), grant, streams: new Set() }
      registrations.set(route, registration)
      if (label) previewRoutes.set(label, route)
      log(`route ${route} connected`)
      control.on('message', (data, isBinary) => {
        if (isBinary) return
        const message = relayControlMessageSchema.safeParse(parseJson(data.toString()))
        if (message.success && message.data.type === 'refuse') registration.waiting.get(message.data.id)?.refuse(502)
      })
      control.on('close', () => {
        if (registrations.get(route) === registration) {
          registrations.delete(route)
          if (label) previewRoutes.delete(label)
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
    if (streams.full(route)) return answer(socket, 503)
    offer(route, registration, kind, streams, {
      socket,
      refuse: (status) => answer(socket, status),
      join(node) {
        let client: WebSocket | undefined
        // ws destroys a socket whose handshake it rejects, and then never calls back.
        const abandoned = (): void => {
          if (!client) node.close(1011)
        }
        socket.once('close', abandoned)
        upgrade(request, socket, head, (upgraded) => {
          client = upgraded
          socket.off('close', abandoned)
          joinWebSockets(route, registration, streams, upgraded, node)
        })
      },
    })
  }

  // Ask the Node for a stream, and hold the client's end until the Node opens its own or gives up.
  function offer(
    route: string,
    registration: Registration,
    kind: string,
    counter: StreamCounter,
    client: ClientEnd,
  ): void {
    const id = randomBytes(16).toString('hex')
    counter.count(route, 1)
    let settled = false
    const settle = (): boolean => {
      if (settled) return false
      settled = true
      clearTimeout(timer)
      client.socket.off('close', gaveUp)
      registration.waiting.delete(id)
      return true
    }
    const refuse = (status: number): void => {
      if (!settle()) return
      counter.count(route, -1)
      client.refuse(status)
    }
    const gaveUp = (): void => {
      if (settle()) counter.count(route, -1)
    }
    const timer = setTimeout(() => refuse(504), acceptTimeoutMs)
    client.socket.once('close', gaveUp)
    registration.waiting.set(id, {
      refuse,
      join(node) {
        if (!settle()) return node.close(1011)
        client.join(node)
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

  // Count a joined stream until either end closes, and let the Node's registration close both ends with it.
  function track(route: string, registration: Registration, counter: StreamCounter, ends: WebSocket[]): () => void {
    let open = true
    const release = (): void => {
      if (!open) return
      open = false
      counter.count(route, -1)
    }
    for (const end of ends) {
      registration.streams.add(end)
      end.once('close', () => registration.streams.delete(end))
      end.once('close', release)
    }
    return release
  }

  // Bytes go across unchanged, with backpressure, and either end closing closes the other.
  function joinWebSockets(
    route: string,
    registration: Registration,
    counter: StreamCounter,
    client: WebSocket,
    node: WebSocket,
  ): void {
    const close = (code: number): void => {
      client.close(code)
      node.close(code)
    }
    track(route, registration, counter, [client, node])
    for (const end of [client, node])
      end.on('message', (_data, isBinary) => {
        if (!isBinary) close(1003)
      })
    const clientBytes = createWebSocketStream(client)
    const nodeBytes = createWebSocketStream(node)
    pipeline(clientBytes, nodeBytes, () => {})
    pipeline(nodeBytes, clientBytes, () => {})
  }

  // The same for a browser's TCP connection: the ClientHello the relay read goes first, then the rest.
  function joinSocket(route: string, registration: Registration, socket: Socket, hello: Buffer, node: WebSocket): void {
    const release = track(route, registration, previews, [node])
    socket.once('close', release)
    node.on('message', (_data, isBinary) => {
      if (!isBinary) node.close(1003)
    })
    const nodeBytes = createWebSocketStream(node)
    nodeBytes.write(hello)
    // `pipe` rather than `pipeline`, which adds enough close listeners to a socket to trip Node's warning.
    socket.pipe(nodeBytes)
    nodeBytes.pipe(socket)
    nodeBytes.on('error', () => socket.destroy())
    nodeBytes.once('close', () => socket.destroy())
    socket.once('close', () => nodeBytes.destroy())
    socket.resume()
  }

  // A browser's TLS connection on the preview domain. The relay reads the server name and nothing else.
  function acceptPreview(domain: string, socket: Socket): void {
    previewSockets.add(socket)
    socket.once('close', () => previewSockets.delete(socket))
    socket.on('error', () => socket.destroy())
    socket.setNoDelay(true)
    const timer = setTimeout(() => socket.destroy(), CLIENT_HELLO_TIMEOUT_MS)
    socket.once('close', () => clearTimeout(timer))
    let received = Buffer.alloc(0)
    const onData = (chunk: Buffer): void => {
      received = Buffer.concat([received, chunk])
      const hello = readClientHello(received)
      if (hello.status === 'incomplete') return
      socket.off('data', onData)
      socket.pause()
      clearTimeout(timer)
      const name = hello.status === 'complete' && hello.serverName ? parsePreviewName(hello.serverName, domain) : null
      const route = name && previewRoutes.get(name.node)
      const registration = route ? registrations.get(route) : undefined
      if (!route || !registration || previews.full(route)) {
        socket.destroy()
        return
      }
      offer(route, registration, RELAY_PREVIEW_STREAM, previews, {
        socket,
        refuse: () => socket.destroy(),
        join: (node) => joinSocket(route, registration, socket, received, node),
      })
    }
    socket.on('data', onData)
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
    // A `preview` stream comes from the preview listener, which counts and limits them.
    if (connectMatch && (!relayStreamKindSchema.safeParse(kind).success || kind === RELAY_PREVIEW_STREAM))
      return answer(socket, 400)
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
    register(route, grant, options.preview ? await previewNodeLabel(route) : undefined, request, socket, head)
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

  let previewServer: TcpServer | undefined
  if (options.preview) {
    const { domain, port, host } = options.preview
    const listener = createTcpServer((socket) => acceptPreview(domain, socket))
    await new Promise<void>((resolve, reject) => {
      listener.once('error', reject)
      listener.listen(port ?? 443, host ?? options.host ?? '127.0.0.1', () => {
        listener.off('error', reject)
        resolve()
      })
    })
    previewServer = listener
  }

  return {
    port: (server.address() as AddressInfo).port,
    ...(previewServer ? { previewPort: (previewServer.address() as AddressInfo).port } : {}),
    close: () =>
      new Promise((resolve) => {
        clearInterval(heartbeat)
        previewServer?.close()
        for (const socket of previewSockets) socket.destroy()
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
