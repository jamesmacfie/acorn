import { createServer, type Server } from 'node:https'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { getRequestListener } from '@hono/node-server'
import { parsePreviewName } from '@acorn/protocol/relay.ts'
import { proxyHttp, proxyUpgrade, type LoopbackProxyOptions } from '../../proxy/loopbackProxy'
import type { PreviewCertificate } from './certificate'
import type { PreviewGrant, PreviewGrants } from './grants'

// What answers on a Node's preview names (docs/relay/phone-channel.md § Previews). It is a server of its
// own, fed by `preview` streams and nothing else, so no route of the Node's API can be reached on these
// names. A request is for a preview that a paired device opened, carries the cookie that device's grant
// issued, and is then handed to the proxy with the page's policy added to every answer.

// The first request of a preview. It trades the entry key for the cookie.
export const PREVIEW_ENTRY_PATH = '/__acorn/preview'
const COOKIE = '__Host-acorn-preview'
// What the page tells the pane that framed it when its browser refused the cookie.
const COOKIE_BLOCKED = 'acorn-preview:cookie-blocked'
const COOKIE_MAX_AGE_SECONDS = 12 * 3600

// What the page may do. Dev servers write inline scripts and evaluate modules, which is why the script
// sources are wide, and why everything else is narrow: the page reaches its own origin and nothing on the
// phone's network. `ancestor` is the one origin that may frame it, or none.
function previewPolicy(host: string, ancestor: string | undefined): string {
  return [
    "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:",
    // `'self'` doesn't cover a WebSocket in every browser.
    `connect-src 'self' wss://${host}`,
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `frame-ancestors ${ancestor ?? "'none'"}`,
  ].join('; ')
}

// A page that tells whatever framed it that this browser held back the cookie, which is what Safari does with
// one a frame from another site sets. The pane turns it into a link that opens the preview as its own page.
const BLOCKED_PAGE = `<!doctype html><meta charset="utf-8"><title>Preview</title>
<p>This browser is blocking the cookie that opens this preview.</p>
<script>parent.postMessage(${JSON.stringify(COOKIE_BLOCKED)}, '*')</script>`

export type PreviewServer = {
  install(certificate: PreviewCertificate): void
  /** A browser's TLS connection, from a `preview` stream. */
  serve(connection: Duplex): void
  close(): void
}

export function createPreviewServer(options: { grants: PreviewGrants; ownPort: number }): PreviewServer {
  let certificate: PreviewCertificate | undefined
  let server: Server | undefined

  const plain = (status: number, text: string, headers: Record<string, string> = {}): Response =>
    new Response(text, {
      status,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers },
    })

  const cookieOf = (header: string | null | undefined): string | undefined =>
    header
      ?.split(/;\s*/)
      .find((pair) => pair.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1)

  // The grant a request is for, and whether it holds the grant's cookie.
  function grantFor(headers: { host?: string; cookie?: string | null }) {
    const host = headers.host ?? ''
    const name = certificate && parsePreviewName(host.replace(/:\d+$/, ''), certificate.domainHost)
    const grant = name && name.node === certificate!.nodeLabel ? options.grants.get(name.preview) : undefined
    return grant && { grant, host, cookie: options.grants.holdsCookie(grant, cookieOf(headers.cookie)) }
  }

  function enter(url: URL, grantId: string): Response {
    const grant = options.grants.spendEntryKey(grantId, url.searchParams.get('key') ?? '')
    if (!grant) return plain(403, 'This preview address was already used or has expired.')
    return new Response(null, {
      status: 302,
      headers: {
        location: '/',
        'cache-control': 'no-store',
        // Partitioned keeps it in a frame in browsers that block cookies across sites but allow these. Safari
        // allows neither, which is what the blocked page is for.
        'set-cookie': `${COOKIE}=${grant.cookie}; Path=/; Secure; HttpOnly; SameSite=None; Partitioned; Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
      },
    })
  }

  async function onRequest(request: Request): Promise<Response> {
    const found = grantFor({ host: request.headers.get('host') ?? '', cookie: request.headers.get('cookie') })
    // A name nobody opened is the same bare refusal as one that never existed.
    if (!found) return plain(403, 'Forbidden')
    const policy = previewPolicy(found.host, found.grant.ancestor)
    const url = new URL(request.url)
    if (url.pathname === PREVIEW_ENTRY_PATH && request.method === 'GET') return enter(url, found.grant.id)
    if (!found.cookie)
      return new Response(BLOCKED_PAGE, {
        status: 403,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-security-policy': policy,
        },
      })
    const proxy = await proxyOptions(found, policy)
    if (!proxy)
      return plain(502, 'This task has no app running on this computer to show.', { 'content-security-policy': policy })
    return proxyHttp(request, proxy)
  }

  async function proxyOptions(
    found: { grant: PreviewGrant; host: string },
    policy: string,
  ): Promise<LoopbackProxyOptions | undefined> {
    const port = await found.grant.port().catch(() => null)
    return port === null
      ? undefined
      : {
          port,
          ownPort: options.ownPort,
          publicOrigin: `https://${found.host}`,
          grantCookie: COOKIE,
          responseHeaders: { 'content-security-policy': policy },
        }
  }

  // A WebSocket upgrade, which a dev server uses for hot reload. Another site could open one with the cookie,
  // so only the page's own origin may.
  async function onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const refuse = (status: string): void =>
      void socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
    const found = grantFor({ host: req.headers.host, cookie: req.headers.cookie })
    if (!found?.cookie || req.headers.origin !== `https://${found.host}`) return refuse('403 Forbidden')
    const proxy = await proxyOptions(found, previewPolicy(found.host, found.grant.ancestor))
    if (!proxy) return refuse('502 Bad Gateway')
    await proxyUpgrade(req, socket, head, proxy)
  }

  function create(current: PreviewCertificate): Server {
    const created = createServer(
      { key: current.keyPem, cert: current.certPem, ALPNProtocols: ['http/1.1'] },
      getRequestListener(onRequest),
    )
    created.on('upgrade', (req, socket, head) => void onUpgrade(req, socket, head).catch(() => socket.destroy()))
    created.on('clientError', (_error, socket) => socket.destroy())
    return created
  }

  return {
    install(next) {
      certificate = next
      if (server) server.setSecureContext({ key: next.keyPem, cert: next.certPem })
      else server = create(next)
    },
    serve(connection) {
      if (server) server.emit('connection', connection)
      else connection.destroy()
    },
    close() {
      server?.closeAllConnections()
      server?.close()
      server = undefined
    },
  }
}
