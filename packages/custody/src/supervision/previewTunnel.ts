import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server, type Socket } from 'node:net'
import { WebSocket } from 'ws'
import { pinnedTlsOptions } from '../broker/nodeBroker'
import { createLogger, describeError } from '@acorn/node-core/server/telemetry'
import { MAX_TUNNEL_MESSAGE_BYTES } from '@acorn/protocol/ws.ts'

const log = createLogger('tunnel')

export type TunnelKey = { nodeId: string; taskId: string; port: number }

export type TunnelNode = {
  // Where the node is listening, as reported at start or pairing time. Never assumed, because the
  // port is ephemeral.
  endpoint: string
  token: string
  // The pinned certificate and its fingerprint. pinnedTlsOptions falls back to no pinning unless
  // both are present, so both are required here, not just the certificate.
  certPem?: string
  fingerprint?: string
}

// Idle-listener reap window: docs/shell/webviews.md § Host-owned webviews.
const IDLE_MS = 60_000

// Per-renderer tunnel cap: docs/shell/webviews.md § Host-owned webviews.
const MAX_TUNNELS = 16

// Header name and case handling: docs/shell/webviews.md § Host-owned webviews.
const TUNNEL_HEADER = 'x-acorn-tunnel'

// The same credential as a cookie, for a shell that cannot inject a header. wry has no `webRequest`,
// so the Tauri shell seeds this into the preview webview's ephemeral cookie store before its first
// navigation. Same secret, same constant-time compare, same per-listener scope, so only the envelope
// differs. See docs/shell.md, "Host-owned webviews".
const TUNNEL_COOKIE = 'acorn_tunnel'

// Told the shell as each listener opens and closes, so it can seed that cookie. The secret goes to
// the shell process and no further, which is the reason it exists.
export type TunnelEvents = {
  opened(port: number, secret: string): void
  closed(port: number): void
}

// Request-head deadline and size bound: docs/shell/webviews.md § Host-owned webviews.
const HEAD_TIMEOUT_MS = 2_000
const MAX_HEAD_BYTES = 8 * 1024

type Entry = {
  id: string
  retired: boolean
  pending: Promise<number>
  reject: (error: Error) => void
  server: Server
  port: number
  sockets: Set<Socket>
  websockets: Set<WebSocket>
  idle: ReturnType<typeof setTimeout> | null
  // Per listener, not per connection: docs/shell/webviews.md § Host-owned webviews.
  secret: string
}

// Byte-level comparison and why: docs/shell/webviews.md § Host-owned webviews.
function matches(presented: string, secret: string): boolean {
  const a = Buffer.from(presented, 'latin1')
  const b = Buffer.from(secret, 'latin1')
  return a.length === b.length && timingSafeEqual(a, b)
}

// Secret check. See docs/shell.md, "Host-owned webviews". Either envelope satisfies it, the injected
// header or the seeded cookie, because both carry the same per-listener secret.
export function headCarriesSecret(head: string, secret: string): boolean {
  for (const line of head.split('\r\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const name = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    if (name === TUNNEL_HEADER && matches(value, secret)) return true
    if (name !== 'cookie') continue
    for (const pair of value.split(';')) {
      const eq = pair.indexOf('=')
      if (eq !== -1 && pair.slice(0, eq).trim() === TUNNEL_COOKIE && matches(pair.slice(eq + 1).trim(), secret)) return true
    }
  }
  return false
}

const key = ({ nodeId, taskId, port }: TunnelKey): string =>
  `${encodeURIComponent(nodeId)}|${encodeURIComponent(taskId)}|${port}`

const partsOf = (id: string): { nodeId: string; taskId: string } => {
  const [nodeId = '', taskId = ''] = id.split('|')
  return { nodeId: decodeURIComponent(nodeId), taskId: decodeURIComponent(taskId) }
}

export class PreviewTunnels {
  private readonly entries = new Map<string, Entry>()
  private disposed = false

  constructor(
    private readonly resolve: (nodeId: string) => TunnelNode | null,
    private readonly events?: TunnelEvents,
    private readonly options: { maxMessageBytes?: number } = {},
  ) {}

  async open(target: TunnelKey): Promise<number> {
    if (this.disposed) throw new Error('Preview tunnels are disposed.')
    const id = key(target)
    const existing = this.entries.get(id)
    if (existing) return existing.pending
    if (this.entries.size >= MAX_TUNNELS) throw new Error('Too many preview tunnels are open.')
    if (!this.resolve(target.nodeId)) throw new Error('That node is not paired.')

    let resolvePort!: (port: number) => void
    let reject!: (error: Error) => void
    const pending = new Promise<number>((resolve, fail) => { resolvePort = resolve; reject = fail })
    const server = createServer((socket) => {
      if (entry.retired) { socket.destroy(); return }
      if (entry.idle) { clearTimeout(entry.idle); entry.idle = null }
      entry.sockets.add(socket)
      socket.on('error', () => socket.destroy())
      socket.on('close', () => {
        entry.sockets.delete(socket)
        this.armIdle(entry)
      })
      // Resolve fresh pins and credentials for every accepted connection.
      const node = this.resolve(target.nodeId)
      if (!node?.certPem || !node.fingerprint) {
        log.warn(`${id}: no pinned certificate for this node; refusing`, { 'tunnel.id': id })
        socket.destroy()
        return
      }
      this.authorize(socket, entry.secret, id, (head) => this.pipe(socket, node, target, entry, head))
    })
    const entry: Entry = {
      id, server, port: 0, retired: false, pending, reject,
      sockets: new Set(), websockets: new Set(), idle: null,
      secret: randomBytes(32).toString('base64url'),
    }
    // Admission includes pending binds and happens before listen can yield.
    this.entries.set(id, entry)
    server.on('error', (error) => {
      log.warn(`listener for ${id} failed: ${describeError(error).message}`, { 'tunnel.id': id })
      reject(error)
      this.closeEntry(entry)
    })
    server.once('listening', () => {
      if (entry.retired) { server.close(); return }
      entry.port = (server.address() as { port: number }).port
      this.events?.opened(entry.port, entry.secret)
      this.armIdle(entry)
      resolvePort(entry.port)
    })
    try { server.listen(0, '127.0.0.1') } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
      this.closeEntry(entry)
    }
    return pending
  }

  // See docs/shell.md, "Host-owned webviews", for how the secret reaches the webview without the
  // preview plugin importing this file.
  headersFor(url: string): Record<string, string> | null {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return null
    }
    // Loopback-only header attachment: docs/shell/webviews.md § Host-owned webviews.
    if (parsed.hostname !== '127.0.0.1') return null
    const port = Number(parsed.port)
    for (const entry of this.entries.values()) {
      if (entry.port > 0 && entry.port === port) return { [TUNNEL_HEADER]: entry.secret }
    }
    return null
  }

  // Reads the request head, checks the secret, then hands the bytes on unchanged, secret header
  // included. A dev server ignores a header it does not recognize, and rewriting the request would
  // mean reserializing it and owning every edge of HTTP framing.
  private authorize(socket: Socket, secret: string, id: string, onAuthorized: (head: Buffer) => void): void {
    let buffered = Buffer.alloc(0)
    const refuse = (reason: string): void => {
      clearTimeout(timer)
      socket.off('data', onData)
      log.warn(`${id}: ${reason}; refusing`, { 'tunnel.id': id })
      socket.destroy()
    }
    const timer = setTimeout(() => refuse('no request head within the deadline'), HEAD_TIMEOUT_MS)
    timer.unref?.()
    socket.once('close', () => clearTimeout(timer))
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk])
      // Byte-level comparison: docs/shell/webviews.md § Host-owned webviews.
      const end = buffered.indexOf('\r\n\r\n', 0, 'latin1')
      if (end === -1) {
        if (buffered.length > MAX_HEAD_BYTES) refuse('request head exceeded its ceiling')
        return
      }
      if (end + 4 > MAX_HEAD_BYTES) { refuse('request head exceeded its ceiling'); return }
      if (!headCarriesSecret(buffered.subarray(0, end).toString('latin1'), secret)) {
        refuse('connection did not present this tunnel\'s secret')
        return
      }
      clearTimeout(timer)
      socket.off('data', onData)
      // Passes everything read so far, not just the head. A POST's body can arrive in the same
      // packet, and dropping it would corrupt the request just authorized.
      try { onAuthorized(buffered) } catch { refuse('could not open the node pipe') }
    }
    socket.on('data', onData)
  }

  // Closes every tunnel for a node, once it is unpaired, revoked, or restarted, or for a task whose
  // pane was unmounted or archived.
  closeFor(match: { nodeId?: string; taskId?: string }): void {
    for (const entry of this.entries.values()) {
      const { nodeId, taskId } = partsOf(entry.id)
      if (match.nodeId && nodeId !== match.nodeId) continue
      if (match.taskId && taskId !== match.taskId) continue
      this.closeEntry(entry)
    }
  }

  dispose(): void {
    this.disposed = true
    this.closeFor({})
  }

  private closeEntry(entry: Entry): void {
    if (entry.retired) return
    entry.retired = true
    if (this.entries.get(entry.id) === entry) this.entries.delete(entry.id)
    entry.reject(new Error('Preview tunnel was closed before opening.'))
    if (entry.port > 0) this.events?.closed(entry.port)
    if (entry.idle) clearTimeout(entry.idle)
    for (const socket of entry.sockets) socket.destroy()
    for (const ws of entry.websockets) ws.terminate()
    entry.server.close()
  }

  private armIdle(entry: Entry): void {
    if (entry.retired || entry.port === 0 || entry.sockets.size > 0 || entry.idle) return
    entry.idle = setTimeout(() => this.closeEntry(entry), IDLE_MS)
    entry.idle.unref?.()
  }

  private pipe(socket: Socket, node: TunnelNode, target: TunnelKey, entry: Entry, head: Buffer): void {
    if (entry.retired) { socket.destroy(); return }
    const id = entry.id
    const url = new URL('/v1/tunnel', node.endpoint)
    url.protocol = 'wss:'
    url.searchParams.set('task', target.taskId)
    url.searchParams.set('port', String(target.port))
    const ws = new WebSocket(url, {
      maxPayload: Math.min(this.options.maxMessageBytes ?? MAX_TUNNEL_MESSAGE_BYTES, MAX_TUNNEL_MESSAGE_BYTES),
      headers: { authorization: `Bearer ${node.token}` },
      // The same pinning helper the broker's HTTPS agent uses, so there is one definition of "is
      // this the node we paired with".
      ...pinnedTlsOptions(node.fingerprint, node.certPem),
    })
    ws.binaryType = 'nodebuffer'
    entry.websockets.add(ws)
    ws.once('close', () => entry.websockets.delete(ws))

    // Paused immediately. The socket is accepted before the WebSocket handshake finishes, so the
    // first bytes of the request would otherwise be dropped, and pausing pushes backpressure onto the
    // kernel instead of buffering without bound. `head` is the one exception, bounded by
    // MAX_HEAD_BYTES: the credential check already consumed those bytes, so something has to replay
    // them.
    socket.pause()

    let closed = false
    const closeBoth = (): void => {
      if (closed) return
      closed = true
      socket.destroy()
      if (ws.readyState === ws.OPEN) ws.close()
      else if (ws.readyState === ws.CONNECTING) ws.terminate()
    }

    // Serialize each slice before releasing TCP backpressure. The authorized head may include a
    // POST body from the same read, so it follows the same splitting rule as all later chunks.
    const send = (chunk: Buffer): void => {
      const maxBytes = Math.min(this.options.maxMessageBytes ?? MAX_TUNNEL_MESSAGE_BYTES, MAX_TUNNEL_MESSAGE_BYTES)
      let offset = 0
      const next = (): void => {
        if (closed || ws.readyState !== ws.OPEN) return closeBoth()
        if (offset === chunk.length) { socket.resume(); return }
        const end = Math.min(offset + maxBytes, chunk.length)
        const part = chunk.subarray(offset, end)
        offset = end
        try { ws.send(part, (error) => { if (error) closeBoth(); else next() }) } catch { closeBoth() }
      }
      next()
    }

    ws.on('open', () => {
      // Resumed only after head is sent, so the request the browser already sent reaches the dev
      // server before anything that follows it on the same connection.
      send(head)
    })
    ws.on('message', (data: Buffer) => {
      try { if (!socket.write(data)) ws.pause() } catch { closeBoth() }
    })
    socket.on('drain', () => { if (!closed) ws.resume() })
    socket.on('data', (chunk: Buffer) => {
      // Backpressure by callback, matching the node side. Stop reading from the browser until the
      // frame reaches the socket, so a slow link cannot grow an unbounded queue in main.
      socket.pause()
      send(chunk)
    })
    ws.on('close', closeBoth)
    ws.on('error', (error) => {
      // A refused upgrade is the normal failure here, from an undeclared port or a dev server that
      // is not running. Silence would leave the preview pane blank with no explanation.
      log.warn(`${id}: ${error.message}`, { 'tunnel.id': id })
      closeBoth()
    })
    socket.on('close', closeBoth)
    socket.on('error', closeBoth)
  }
}
