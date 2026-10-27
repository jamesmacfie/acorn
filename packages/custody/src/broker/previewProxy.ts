import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingHttpHeaders, type IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { PreviewTransport } from './nodeBroker'

// A remote Node's preview, shown in a desktop webview (docs/shell/bridge-and-broker.md § Previews). Each preview
// gets a listener of its own on 127.0.0.1, so each is its own origin and one task's page can't call another's.
// The listener forwards to the Node's loopback route over the broker's pinned connection, and the Node forwards
// to the dev server. What the page may reach is decided here, by the policy below, and by the webview's
// navigation rule in the shell.

export type PreviewListener = {
  origin: string
  /** The first address to load, which sets the cookie and goes on to `path` on this origin. */
  entry(path?: string): string
  close(): Promise<void>
}

const ENTRY_PATH = '/__acorn/preview'
const COOKIE = 'acorn-preview'
// Dev servers inject inline scripts and evaluate modules, so the script sources are wide. Everything the page
// can send a request to is its own origin, which is this listener.
export const PREVIEW_POLICY =
  "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; connect-src 'self'; form-action 'self'; " +
  "base-uri 'self'; object-src 'none'; frame-ancestors 'none'"

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
// The Node's own credential is the broker's to add, and a page's is nobody's business on the Node.
const NOT_FORWARDED = new Set(['host', 'authorization', 'proxy-authorization', 'x-acorn-internal'])

const matches = (expected: string, presented: string | undefined | null): boolean => {
  if (!presented) return false
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  return a.byteLength === b.byteLength && timingSafeEqual(a, b)
}

const cookies = (header: string | undefined): string[] => (header ? header.split(/;\s*/) : [])

// The page's headers as the Node should see them: no Host, no credential, and not this listener's cookie.
function forwarded(headers: IncomingHttpHeaders, upgrade: boolean): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || NOT_FORWARDED.has(name)) continue
    if (HOP_BY_HOP.has(name) && !(upgrade && (name === 'connection' || name === 'upgrade'))) continue
    if (name === 'cookie') {
      const rest = cookies(String(value)).filter((pair) => !pair.startsWith(`${COOKIE}=`))
      if (rest.length) result.cookie = rest.join('; ')
    } else result[name] = Array.isArray(value) ? value.join(', ') : value
  }
  return result
}

// Where the entry goes on. Only a path on this origin, never `//elsewhere`.
const startPath = (path: string | null): string => (path && /^\/(?![/\\])/.test(path) ? path : '/')

/**
 * Start one preview's listener. `route` is the Node's loopback route for the task, such as
 * `/v1/p/preview/tasks/t1/proxy`.
 */
export async function openPreviewListener(transport: PreviewTransport, route: string): Promise<PreviewListener> {
  const secret = randomBytes(32).toString('base64url')
  let host = ''
  // Upgraded sockets have left the server's own count, so closing it doesn't close them.
  const upgraded = new Set<Duplex>()

  // Who may use this listener: the window that loaded the entry, on the name the listener bound. A matching
  // Host stops DNS rebinding. The cookie stops a browser tab or another process on this computer.
  const admitted = (req: IncomingMessage): boolean =>
    req.headers.host === host &&
    cookies(req.headers.cookie).some(
      (pair) => pair.startsWith(`${COOKIE}=`) && matches(secret, pair.slice(COOKIE.length + 1)),
    )

  // The Node's path for a page's request, or null for one that would leave the route once `..` is resolved.
  const nodePath = (url: string | undefined): string | null => {
    if (!url?.startsWith('/')) return null
    const target = new URL(`${route}${url}`, 'http://node.invalid')
    return target.pathname.startsWith(`${route}/`) ? `${target.pathname}${target.search}` : null
  }

  const server = createServer((req, res) => {
    const refuse = (status: number, message: string): void =>
      void res
        .writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'content-security-policy': PREVIEW_POLICY })
        .end(message)
    if (req.headers.host !== host) return refuse(403, 'This preview answers only on its own address.')
    // A throw here would take the helper down, and any process on this computer can send a malformed address.
    if (!URL.canParse(req.url ?? '/', `http://${host}`)) return refuse(400, 'That address is outside this preview.')
    const url = new URL(req.url ?? '/', `http://${host}`)
    if (url.pathname === ENTRY_PATH && req.method === 'GET') {
      if (!matches(secret, url.searchParams.get('key'))) return refuse(403, 'This preview link has expired.')
      return void res
        .writeHead(302, {
          'set-cookie': `${COOKIE}=${secret}; HttpOnly; SameSite=Strict; Path=/`,
          location: startPath(url.searchParams.get('to')),
          'content-security-policy': PREVIEW_POLICY,
        })
        .end()
    }
    if (!admitted(req)) return refuse(403, 'This preview belongs to the acorn window that opened it.')
    const target = nodePath(req.url)
    if (!target) return refuse(400, 'That address is outside this preview.')
    const upstream = transport.request(target, { method: req.method ?? 'GET', headers: forwarded(req.headers, false) })
    if (!upstream) return refuse(410, 'This preview’s Node is no longer connected.')
    upstream.once('response', (answer) => {
      const headers: Record<string, string | string[]> = {}
      for (const [name, value] of Object.entries(answer.headers)) {
        if (value === undefined || HOP_BY_HOP.has(name)) continue
        // The app may set its own cookies, but not this listener's.
        headers[name] =
          name === 'set-cookie' ? [value].flat().filter((one) => !one.trimStart().startsWith(`${COOKIE}=`)) : value
      }
      // Beside any policy the app sends. A browser enforces each one, so the app can narrow it but not widen it.
      headers['content-security-policy'] = [headers['content-security-policy'] ?? [], PREVIEW_POLICY].flat()
      res.writeHead(answer.statusCode ?? 502, headers)
      // Streamed, so a server-sent event reaches the page as it's written.
      answer.pipe(res)
    })
    upstream.once('error', () => (res.headersSent ? res.destroy() : refuse(502, 'Couldn’t reach the Node.')))
    // A page that goes away mid-answer frees the Node's socket. A finished one leaves it in the pool.
    res.once('close', () => {
      if (!res.writableFinished) upstream.destroy()
    })
    req.pipe(upstream)
  })

  // A dev server's live reload socket. Only the page's own origin may open one, as well as the cookie's holder.
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => socket.destroy())
    const refuse = (status: number): void =>
      void socket.end(`HTTP/1.1 ${status} \r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
    const target = nodePath(req.url)
    if (!admitted(req) || req.headers.origin !== `http://${host}`) return refuse(403)
    if (!target) return refuse(400)
    const upstream = transport.request(target, { method: 'GET', headers: forwarded(req.headers, true) })
    if (!upstream) return refuse(410)
    upstream.once('upgrade', (answer, node, nodeHead) => {
      upgraded.add(socket)
      const lines = []
      for (let i = 0; i < answer.rawHeaders.length; i += 2)
        lines.push(`${answer.rawHeaders[i]}: ${answer.rawHeaders[i + 1]}`)
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join('\r\n')}\r\n\r\n`)
      if (nodeHead.length) socket.write(nodeHead)
      if (head.length) node.write(head)
      node.on('error', () => socket.destroy())
      node.once('close', () => socket.destroy())
      socket.once('close', () => {
        upgraded.delete(socket)
        node.destroy()
      })
      node.pipe(socket)
      socket.pipe(node)
    })
    upstream.once('response', (answer) => {
      answer.resume()
      refuse(answer.statusCode ?? 502)
    })
    upstream.once('error', () => socket.destroy())
    upstream.end()
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const { port } = server.address() as { port: number }
  host = `127.0.0.1:${port}`
  const origin = `http://${host}`
  return {
    origin,
    entry: (path = '/') => `${origin}${ENTRY_PATH}?key=${secret}&to=${encodeURIComponent(path)}`,
    close: () =>
      new Promise<void>((resolve) => {
        transport.close()
        server.closeAllConnections()
        for (const socket of upgraded) socket.destroy()
        server.close(() => resolve())
      }),
  }
}
