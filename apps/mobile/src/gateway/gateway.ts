import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import { z } from 'zod'
import type { NodeBroker } from '@acorn/custody/broker'
import type { PairingCodes } from '@acorn/node-core/server/auth/pairingCodes.ts'
import { createLogger, describeError } from '@acorn/node-core/server/telemetry'
import { nodeFetchRequestSchema, type NodeStatus, type NodeTransportError } from '@acorn/protocol/broker.ts'
import { MAX_NODE_WS_MESSAGE_BYTES, wsFrameSchema, wsSubscriptionIntentSchema } from '@acorn/protocol/ws.ts'
import { refusal } from './denylist'
import type { SessionStore } from './sessions'

const log = createLogger('gateway')

// A phone's browser can't hold a device token or trust a pinned certificate, so this server holds a
// session for it instead and forwards to the Node through the broker, the way the desktop helper does
// for its renderer (apps/desktop/src/helper/helperServer.ts). It listens on loopback only. Something
// in front of it, such as `tailscale serve`, gives phones a trusted HTTPS name.
//
// Three checks guard every route: `Host` must name the address phones open, so a page on another
// name that resolves here can't read the answers. `Origin` must match it on every request with a body
// and on the socket upgrade. And every `/node` request and the upgrade need a live session cookie.

// The desktop helper's request ceiling. The broker bounds answers and socket messages itself.
const MAX_REQUEST_BYTES = 16 * 1024 * 1024
const MAX_SIGN_IN_BYTES = 4 * 1024
const COOKIE = 'acorn_session'
// 400 days, the longest a browser keeps a cookie. A session lasts until someone revokes it.
const COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60
// How often open sockets are checked against the session files, so a revoke closes one within a
// second. A close with this code tells the phone it's signed out rather than offline.
const SESSION_CHECK_MS = 500
export const SIGNED_OUT_CLOSE_CODE = 4401
// A phone that leaves the network drops its socket without a close, and its event viewer would hold
// one of the Node connection's viewer slots until TCP gave up.
const PING_MS = 15_000

// Headers that describe the phone's connection to this server rather than a request to the Node. The
// cookie is this server's credential and the broker sets the Node's own.
const NOT_FORWARDED = new Set([
  'authorization',
  'connection',
  'content-length',
  'cookie',
  'forwarded',
  'host',
  'keep-alive',
  'origin',
  'proxy-authorization',
  'referer',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])
const NOT_RETURNED = new Set(['connection', 'content-length', 'keep-alive', 'set-cookie', 'transfer-encoding'])

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
}

const signInSchema = z.strictObject({ code: z.string().min(1).max(256) })
const phoneMessageSchema = z.strictObject({
  frame: wsFrameSchema,
  intent: wsSubscriptionIntentSchema.optional(),
  cleanup: z.boolean().optional(),
})

export type GatewayBroker = Pick<NodeBroker, 'fetch' | 'abort' | 'send' | 'openViewer' | 'closeViewer'>

export type Gateway = {
  port: number
  // The broker's events for this gateway's Node, passed on to the phones' sockets. A viewer ID sends
  // to that phone only.
  frame(frame: unknown, viewerId?: string): void
  bytes(frame: Uint8Array, viewerId?: string): void
  status(status: NodeStatus): void
  transportError(error: NodeTransportError, viewerId?: string): void
  close(): Promise<void>
}

type Phone = { viewerId: string; session: string; answeredPing: boolean }

const answer = (res: ServerResponse, status: number, code: string, message: string): void => {
  res
    .writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    .end(JSON.stringify({ error: { code, message } }))
}

/** The request body, or null when it's larger than `max`. */
function readBody(req: IncomingMessage, max: number): Promise<Buffer | null> {
  if (Number(req.headers['content-length']) > max) return Promise.resolve(null)
  return new Promise((done, fail) => {
    const chunks: Buffer[] = []
    let size = 0
    const onData = (chunk: Buffer): void => {
      size += chunk.length
      if (size <= max) return void chunks.push(chunk)
      req.off('data', onData)
      req.pause()
      done(null)
    }
    req.on('data', onData)
    req.once('end', () => done(Buffer.concat(chunks)))
    req.once('error', fail)
  })
}

const forwardedHeaders = (headers: IncomingHttpHeaders): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' &&
        !NOT_FORWARDED.has(entry[0]) &&
        !entry[0].startsWith('sec-') &&
        !entry[0].startsWith('x-forwarded-'),
    ),
  )

const returnedHeaders = (headers: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(headers).filter(([name]) => !NOT_RETURNED.has(name.toLowerCase())))

export function startGateway(options: {
  broker: GatewayBroker
  nodeId: string
  /** The Node's name in the gateway's fleet, which a phone shows as its Node's name. */
  label: string
  sessions: SessionStore
  codes: PairingCodes
  /** The address phones open, such as https://host.tailnet.ts.net. */
  origin: string
  /** The built web app. */
  appDir: string
  port: number
}): Promise<Gateway> {
  const { broker, nodeId, sessions, codes } = options
  const served = new URL(options.origin)
  const appDir = resolve(options.appDir)
  const phones = new Map<WebSocket, Phone>()
  let latest: NodeStatus | undefined

  const sessionOf = (req: IncomingMessage): string | null => {
    const id = new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]+)`).exec(req.headers.cookie ?? '')?.[1]
    return id ? sessions.use(id) : null
  }

  const signIn = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body = await readBody(req, MAX_SIGN_IN_BYTES)
    let code: string | undefined
    try {
      code = body ? signInSchema.parse(JSON.parse(body.toString('utf8'))).code : undefined
    } catch {
      code = undefined
    }
    // One answer for every failure, as Node pairing gives, so a guess learns nothing but "no".
    if (!code || !codes.consume(code)) {
      res.setHeader('connection', 'close')
      return answer(res, 401, 'sign_in_failed', "That code didn't work. Get a new one from the gateway.")
    }
    const sessionId = sessions.create(req.headers['user-agent'])
    res
      .writeHead(204, {
        'set-cookie': `${COOKIE}=${sessionId}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${COOKIE_MAX_AGE_S}`,
      })
      .end()
  }

  const forward = async (
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    requestId: string,
    session: string,
  ): Promise<void> => {
    const path = url.pathname.slice('/node'.length) || '/'
    const refused = refusal(req.method ?? 'GET', path)
    if (refused) return answer(res, 403, 'gateway_refused', refused)
    const body = await readBody(req, MAX_REQUEST_BYTES)
    if (!body) {
      res.setHeader('connection', 'close')
      return answer(res, 413, 'payload_too_large', 'The request is larger than the gateway accepts.')
    }
    const request = nodeFetchRequestSchema.safeParse({
      // Scoped to the session, so one phone's request ID can't collide with another's.
      requestId: `${session.slice(0, 12)}:${requestId}`,
      path: path + url.search,
      method: req.method,
      headers: forwardedHeaders(req.headers),
      ...(body.length ? { body: { kind: 'bytes', bytes: new Uint8Array(body) } } : {}),
    })
    if (!request.success) return answer(res, 400, 'bad_request', 'The gateway refused a request it could not forward.')
    // A phone that gives up on a request closes it, and the Node stops working on it.
    res.once('close', () => {
      if (!res.writableFinished) broker.abort(request.data.requestId)
    })
    try {
      const response = await broker.fetch(nodeId, request.data)
      res.writeHead(response.status, returnedHeaders(response.headers)).end(response.body)
    } catch (error) {
      if (res.destroyed) return
      const { name, message } = describeError(error)
      answer(res, name === 'TimeoutError' ? 504 : 502, 'node_unreachable', message)
    }
  }

  const serveApp = async (url: URL, res: ServerResponse): Promise<void> => {
    // A path without an extension is one of the app's own routes, so it gets the page.
    let file = ''
    try {
      file = resolve(appDir, `.${extname(url.pathname) ? decodeURIComponent(url.pathname) : '/index.html'}`)
    } catch {
      // A malformed escape, refused below with everything else outside the app.
    }
    if (!file.startsWith(appDir + sep)) return answer(res, 404, 'not_found', 'Nothing is served at that path.')
    let bytes: Buffer
    try {
      bytes = await readFile(file)
    } catch {
      return answer(res, 404, 'not_found', `Nothing is served at that path. If the web app isn't built, build it.`)
    }
    res
      .writeHead(200, {
        'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
        'content-security-policy': "script-src 'self'",
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-cache',
      })
      .end(bytes)
  }

  const handle = async (req: IncomingMessage, res: ServerResponse, url: URL, requestId: string): Promise<void> => {
    const method = req.method ?? 'GET'
    if (req.headers.host !== served.host) return answer(res, 403, 'wrong_host', `This gateway serves ${served.origin}.`)
    if (method !== 'GET' && method !== 'HEAD' && req.headers.origin !== served.origin)
      return answer(res, 403, 'wrong_origin', `Requests must come from ${served.origin}.`)
    if (url.pathname === '/session' && method === 'POST') return signIn(req, res)
    const isNode = url.pathname === '/node' || url.pathname.startsWith('/node/')
    if (isNode || (url.pathname === '/session' && method === 'GET')) {
      const session = sessionOf(req)
      if (!session) return answer(res, 401, 'signed_out', 'Sign in to the gateway with a code.')
      if (isNode) return forward(req, res, url, requestId, session)
      // Which Node this gateway serves, so the phone can list it before its socket opens, and tell
      // a signed-out phone from a gateway it can't reach.
      res
        .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify({ nodeId, label: options.label }))
      return
    }
    if (method === 'GET') return serveApp(url, res)
    answer(res, 404, 'not_found', 'Nothing is served at that path.')
  }

  const http = createServer((req, res) => {
    const startedAt = performance.now()
    const presented = req.headers['x-request-id']
    const requestId = typeof presented === 'string' && presented.length <= 128 && presented ? presented : randomUUID()
    let url: URL
    try {
      url = new URL(req.url ?? '/', served.origin)
    } catch {
      return answer(res, 400, 'bad_request', 'The gateway could not read that address.')
    }
    // The ID, method, path, status, and time, and never a cookie, a code, a token, or a body.
    res.once('close', () =>
      log.info(`${req.method} ${url.pathname} ${res.writableFinished ? res.statusCode : 'dropped'}`, {
        'request.id': requestId,
        'duration.ms': Math.round(performance.now() - startedAt),
      }),
    )
    handle(req, res, url, requestId).catch((error: unknown) => {
      log.error(`request failed: ${describeError(error).message}`, { 'request.id': requestId })
      if (!res.headersSent) answer(res, 500, 'gateway_error', 'The gateway failed to answer.')
      else res.destroy()
    })
  })

  const send = (ws: WebSocket, payload: string | Uint8Array): void => {
    if (ws.readyState !== ws.OPEN) return
    ws.send(payload, (error) => {
      if (error) ws.terminate()
    })
  }
  const deliver = (payload: string | Uint8Array, viewerId?: string): void => {
    for (const [ws, phone] of phones) if (!viewerId || phone.viewerId === viewerId) send(ws, payload)
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_NODE_WS_MESSAGE_BYTES })
  http.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy())
    const session =
      req.url === '/events' && req.headers.host === served.host && req.headers.origin === served.origin
        ? sessionOf(req)
        : null
    log.info(`${req.method} ${req.url?.split('?')[0]} ${session ? 101 : 'refused'}`)
    if (!session) return void socket.destroy()
    wss.handleUpgrade(req, socket, head, (ws) => {
      const phone: Phone = { viewerId: randomUUID(), session, answeredPing: true }
      phones.set(ws, phone)
      broker.openViewer(nodeId, phone.viewerId)
      if (latest) send(ws, JSON.stringify({ status: latest }))
      ws.on('pong', () => (phone.answeredPing = true))
      ws.on('message', (data, isBinary) => {
        try {
          const message = isBinary ? null : phoneMessageSchema.safeParse(JSON.parse(String(data)))
          if (!message?.success) return
          const { frame, intent, cleanup } = message.data
          broker.send(nodeId, frame, {
            viewerId: phone.viewerId,
            ...(intent ? { intent } : {}),
            ...(cleanup === undefined ? {} : { cleanup }),
          })
        } catch {
          // Not JSON, or a frame the broker refused. The phone's next socket starts clean.
          ws.terminate()
        }
      })
      ws.once('close', () => {
        phones.delete(ws)
        broker.closeViewer(nodeId, phone.viewerId)
      })
    })
  })

  const sessionCheck = setInterval(() => {
    for (const [ws, phone] of phones) if (!sessions.isLive(phone.session)) ws.close(SIGNED_OUT_CLOSE_CODE, 'Signed out')
  }, SESSION_CHECK_MS)
  const heartbeat = setInterval(() => {
    for (const [ws, phone] of phones) {
      if (!phone.answeredPing) {
        ws.terminate()
        continue
      }
      phone.answeredPing = false
      ws.ping()
    }
  }, PING_MS)
  sessionCheck.unref()
  heartbeat.unref()

  return new Promise<Gateway>((done, fail) => {
    http.once('error', fail)
    http.listen(options.port, '127.0.0.1', () => {
      const address = http.address()
      if (!address || typeof address === 'string') return fail(new Error('The gateway did not bind a port.'))
      done({
        port: address.port,
        frame: (frame, viewerId) => deliver(JSON.stringify({ frame }), viewerId),
        bytes: (frame, viewerId) => deliver(frame, viewerId),
        status: (status) => {
          latest = status
          deliver(JSON.stringify({ status }))
        },
        transportError: (error, viewerId) => deliver(JSON.stringify({ error }), viewerId),
        close: () =>
          new Promise<void>((closed) => {
            clearInterval(sessionCheck)
            clearInterval(heartbeat)
            for (const ws of phones.keys()) ws.terminate()
            wss.close()
            http.closeAllConnections()
            http.close(() => closed())
          }),
      })
    })
  })
}
