import { request as httpRequest, type IncomingMessage } from 'node:http'
import { connect, type Socket } from 'node:net'
import { Readable, type Duplex } from 'node:stream'

// The rules that make it safe to put a task's dev server in front of a browser (docs/plugins/plugin-api.md § Loopback routes).
// A plugin supplies a port and nothing else, so what the page can reach and what it learns about this Node
// are decided here, once: only the Node's own loopback, never a name to resolve, never this Node's own port,
// no redirect followed, and none of the Node's credentials passed on.

export type LoopbackProxyOptions = {
  /** The dev server's port on this computer's loopback. */
  port: number
  /** The origin the browser loads the page from, which the dev server must see as its own. */
  publicOrigin: string
  /** The path this proxy is mounted at, which the dev server doesn't see. */
  mount?: string
  /** The Node's own port, which no proxy may reach. */
  ownPort: number
  /** The grant cookie that belongs to the Node and not the app. */
  grantCookie?: string
  /** Added to every response, beside the app's own. */
  responseHeaders?: Record<string, string>
}

const LOOPBACK_HOSTS = ['127.0.0.1', '::1'] as const
type LoopbackHost = (typeof LOOPBACK_HOSTS)[number]
const CONNECT_TIMEOUT_MS = 2_000
// Which loopback address answered last for a port, so a dev server on `::1` isn't tried on IPv4 each time.
const lastAnswered = new Map<number, LoopbackHost>()

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])
// What the Node's own callers carry, and the page's app has no business with.
const NODE_CREDENTIALS = new Set(['authorization', 'proxy-authorization', 'x-acorn-internal'])

// A connected socket to the port on 127.0.0.1, or else ::1. A name is never resolved.
async function connectLoopback(port: number): Promise<Socket> {
  const known = lastAnswered.get(port)
  const order = known ? [known, ...LOOPBACK_HOSTS.filter((host) => host !== known)] : LOOPBACK_HOSTS
  let failure: unknown
  for (const host of order) {
    try {
      const socket = await new Promise<Socket>((resolve, reject) => {
        const attempt = connect({ host, port, timeout: CONNECT_TIMEOUT_MS })
        attempt.once('connect', () => {
          attempt.setTimeout(0)
          resolve(attempt)
        })
        attempt.once('timeout', () => attempt.destroy(new Error('timed out')))
        attempt.once('error', reject)
      })
      lastAnswered.set(port, host)
      return socket
    } catch (error) {
      failure = error
    }
  }
  lastAnswered.delete(port)
  throw failure
}

// The request's headers as the dev server should see them. `keep` names hop-by-hop headers an upgrade needs.
function upstreamHeaders(headers: Headers, options: LoopbackProxyOptions, keep: Set<string>): Record<string, string> {
  const origin = `http://localhost:${options.port}`
  const toDevServer = (value: string): string =>
    options.publicOrigin && value.startsWith(options.publicOrigin)
      ? origin + value.slice(options.publicOrigin.length)
      : value
  const result: Record<string, string> = {}
  for (const [name, value] of headers) {
    if (NODE_CREDENTIALS.has(name) || name === 'host' || (HOP_BY_HOP.has(name) && !keep.has(name))) continue
    if (name === 'origin' || name === 'referer') result[name] = toDevServer(value)
    else if (name === 'cookie' && options.grantCookie) {
      const rest = value.split(/;\s*/).filter((pair) => !pair.startsWith(`${options.grantCookie}=`))
      if (rest.length) result[name] = rest.join('; ')
    } else result[name] = value
  }
  result.host = `localhost:${options.port}`
  return result
}

// A `Location` on the dev server's own origin becomes a path, so a redirect stays inside the preview. Any
// other address passes through, and the page's policy decides whether it may go there.
export function rewriteLocation(location: string, port: number): string {
  if (!URL.canParse(location)) return location
  const url = new URL(location)
  const sameServer =
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    Number(url.port || 80) === port
  return sameServer ? `${url.pathname}${url.search}${url.hash}` : location
}

function refusal(options: LoopbackProxyOptions, status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...options.responseHeaders },
  })
}

// Forward one HTTP request with both bodies streamed, so a server-sent event reaches the page as it is
// written. Only the path and query of the request's address are used, so an address that names another
// host reaches the dev server all the same.
export async function proxyHttp(request: Request, options: LoopbackProxyOptions): Promise<Response> {
  if (options.port === options.ownPort) return refusal(options, 403, 'That port belongs to this Node.')
  let socket: Socket
  try {
    socket = await connectLoopback(options.port)
  } catch {
    return refusal(options, 502, `Nothing is answering on port ${options.port}. Is the dev server running?`)
  }
  const url = new URL(request.url)
  return new Promise<Response>((resolve) => {
    const upstream = httpRequest({
      createConnection: () => socket,
      method: request.method,
      path: `${url.pathname.slice(options.mount?.length ?? 0) || '/'}${url.search}`,
      headers: upstreamHeaders(request.headers, options, new Set()),
      setHost: false,
    })
    request.signal.addEventListener('abort', () => upstream.destroy(), { once: true })
    upstream.once('error', () => resolve(refusal(options, 502, 'The app closed the connection.')))
    upstream.once('response', (answer: IncomingMessage) => {
      const headers = new Headers()
      for (const [name, value] of Object.entries(answer.headers)) {
        if (value === undefined || HOP_BY_HOP.has(name) || name === 'x-frame-options') continue
        for (const one of Array.isArray(value) ? value : [value])
          headers.append(name, name === 'location' ? rewriteLocation(one, options.port) : one)
      }
      for (const [name, value] of Object.entries(options.responseHeaders ?? {})) headers.append(name, value)
      const status = answer.statusCode ?? 502
      const empty = request.method === 'HEAD' || [204, 205, 304].includes(status)
      if (empty) answer.resume()
      resolve(new Response(empty ? null : (Readable.toWeb(answer) as ReadableStream), { status, headers }))
    })
    if (request.body) Readable.fromWeb(request.body as import('node:stream/web').ReadableStream).pipe(upstream)
    else upstream.end()
  })
}

// Hand a WebSocket upgrade to the dev server, and then pipe bytes in both directions without reading them.
// The caller checks the `Origin` first, because it knows what the page's own origin is.
export async function proxyUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  options: LoopbackProxyOptions,
): Promise<void> {
  const fail = (status: 403 | 502): void =>
    void socket.end(
      `HTTP/1.1 ${status} ${status === 403 ? 'Forbidden' : 'Bad Gateway'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    )
  if (options.port === options.ownPort) return fail(403)
  if (!req.url?.startsWith('/')) return fail(502)
  let upstream: Socket
  try {
    upstream = await connectLoopback(options.port)
  } catch {
    return fail(502)
  }
  const headers = upstreamHeaders(
    new Headers(req.headers as Record<string, string>),
    options,
    new Set(['connection', 'upgrade']),
  )
  const lines = Object.entries(headers).map(([name, value]) => `${name}: ${value}`)
  upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`)
  if (head.length) upstream.write(head)
  upstream.on('error', () => socket.destroy())
  socket.on('error', () => upstream.destroy())
  upstream.once('close', () => socket.destroy())
  socket.once('close', () => upstream.destroy())
  upstream.pipe(socket)
  socket.pipe(upstream)
}
