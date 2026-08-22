import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server, type Socket } from 'node:net'
import { WebSocket } from 'ws'
import { pinnedTlsOptions } from './nodeBroker'

export type TunnelKey = { nodeId: string; taskId: string; port: number }

export type TunnelNode = {
  // Where the node is listening, as reported at start or pairing time. Never assumed; the port is
  // ephemeral.
  endpoint: string
  token: string
  // The pinned certificate and its fingerprint. pinnedTlsOptions falls back to no pinning unless
  // both are present, so both are required here, not just the certificate.
  certPem?: string
  fingerprint?: string
}

// Idle-listener reap window: docs/electron.md § Host-owned webviews.
const IDLE_MS = 60_000

// Per-renderer tunnel cap: docs/electron.md § Host-owned webviews.
const MAX_TUNNELS = 16

// Header name and case handling: docs/electron.md § Host-owned webviews.
const TUNNEL_HEADER = 'x-acorn-tunnel'

// Request-head deadline and size bound: docs/electron.md § Host-owned webviews.
const HEAD_TIMEOUT_MS = 2_000
const MAX_HEAD_BYTES = 8 * 1024

type Entry = {
  server: Server
  port: number
  sockets: Set<Socket>
  idle: ReturnType<typeof setTimeout> | null
  // Per listener, not per connection: docs/electron.md § Host-owned webviews.
  secret: string
}

// Secret check: docs/electron.md § Host-owned webviews.
function headCarriesSecret(head: string, secret: string): boolean {
  for (const line of head.split('\r\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    if (line.slice(0, colon).trim().toLowerCase() !== TUNNEL_HEADER) continue
    const presented = Buffer.from(line.slice(colon + 1).trim())
    const expected = Buffer.from(secret)
    if (presented.length === expected.length && timingSafeEqual(presented, expected)) return true
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
  // Dedupes overlapping opens for the same key: docs/electron.md § Host-owned webviews.
  private readonly opening = new Map<string, Promise<number>>()

  constructor(private readonly resolve: (nodeId: string) => TunnelNode | null) {}

  async open(target: TunnelKey): Promise<number> {
    const id = key(target)
    const existing = this.entries.get(id)
    if (existing) return existing.port
    const inFlight = this.opening.get(id)
    if (inFlight) return inFlight

    const pending = this.listen(id, target).finally(() => this.opening.delete(id))
    this.opening.set(id, pending)
    return pending
  }

  private async listen(id: string, target: TunnelKey): Promise<number> {
    if (this.entries.size >= MAX_TUNNELS) throw new Error('Too many preview tunnels are open.')
    // Resolved here only to fail early with a clear message. Every connection re-resolves
    // separately, since a restart or a re-pair can change the endpoint, the token, and the
    // certificate.
    if (!this.resolve(target.nodeId)) throw new Error('That node is not paired.')

    const sockets = new Set<Socket>()
    // Secret generation: docs/electron.md § Host-owned webviews.
    const secret = randomBytes(32).toString('base64url')
    const server = createServer((socket) => {
      const entry = this.entries.get(id)
      if (entry?.idle) {
        clearTimeout(entry.idle)
        entry.idle = null
      }
      sockets.add(socket)
      socket.on('close', () => {
        sockets.delete(socket)
        this.armIdle(id)
      })
      // Re-resolved per connection, same reasoning as open() above: a restart or re-pair changes
      // which endpoint, token, and certificate are current.
      const node = this.resolve(target.nodeId)
      if (!node?.certPem || !node.fingerprint) {
        // No pinned certificate, no tunnel. Every other path to a node goes through the pinned
        // agent, and a raw byte pipe is the last place to make an exception.
        console.warn(`[tunnel] ${id}: no pinned certificate for this node; refusing`)
        socket.destroy()
        return
      }
      // The credential check runs before anything dials the node, so an unauthorized connection
      // costs one destroyed socket rather than an upgrade attempt against the owner's device token.
      this.authorize(socket, secret, id, (head) => this.pipe(socket, node, target, id, head))
    })
    // Loopback bind: docs/electron.md § Host-owned webviews.
    const port = await new Promise<number>((resolvePort, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolvePort((server.address() as { port: number }).port))
    })
    server.on('error', (error) => {
      // A dead listener must not stay in the map, or a later open() would hand back a port nothing
      // is listening on.
      console.warn(`[tunnel] listener for ${id} failed:`, error)
      this.closeEntry(id)
    })
    this.entries.set(id, { server, port, sockets, idle: null, secret })
    this.armIdle(id)
    return port
  }

  // How the secret reaches the WebContentsView without the preview plugin importing this file:
  // docs/electron.md § Host-owned webviews.
  headersFor(url: string): Record<string, string> | null {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return null
    }
    // Loopback-only header attachment: docs/electron.md § Host-owned webviews.
    if (parsed.hostname !== '127.0.0.1') return null
    const port = Number(parsed.port)
    for (const entry of this.entries.values()) {
      if (entry.port === port) return { [TUNNEL_HEADER]: entry.secret }
    }
    return null
  }

  // Reads the request head, checks the secret, then hands the bytes on unchanged, secret header
  // included. A dev server ignores a header it does not recognize, and rewriting the request would
  // mean reserializing it and owning every edge of HTTP framing for no benefit.
  private authorize(socket: Socket, secret: string, id: string, onAuthorized: (head: Buffer) => void): void {
    let buffered = Buffer.alloc(0)
    const refuse = (reason: string): void => {
      clearTimeout(timer)
      socket.off('data', onData)
      console.warn(`[tunnel] ${id}: ${reason}; refusing`)
      socket.destroy()
    }
    const timer = setTimeout(() => refuse('no request head within the deadline'), HEAD_TIMEOUT_MS)
    timer.unref?.()
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk])
      // Byte-level comparison: docs/electron.md § Host-owned webviews.
      const end = buffered.indexOf('\r\n\r\n', 0, 'latin1')
      if (end === -1) {
        if (buffered.length > MAX_HEAD_BYTES) refuse('request head exceeded its ceiling')
        return
      }
      if (!headCarriesSecret(buffered.subarray(0, end).toString('latin1'), secret)) {
        refuse('connection did not present this tunnel\'s secret')
        return
      }
      clearTimeout(timer)
      socket.off('data', onData)
      // Passes everything read so far, not just the head: a POST's body can arrive in the same
      // packet, and dropping it would corrupt the request just authorized.
      onAuthorized(buffered)
    }
    socket.on('data', onData)
  }

  // Closes every tunnel for a node (unpaired, revoked, restarted) or for a task (pane unmounted or
  // archived).
  closeFor(match: { nodeId?: string; taskId?: string }): void {
    for (const id of [...this.entries.keys()]) {
      const { nodeId, taskId } = partsOf(id)
      if (match.nodeId && nodeId !== match.nodeId) continue
      if (match.taskId && taskId !== match.taskId) continue
      this.closeEntry(id)
    }
  }

  dispose(): void {
    this.closeFor({})
  }

  private closeEntry(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.delete(id)
    if (entry.idle) clearTimeout(entry.idle)
    for (const socket of entry.sockets) socket.destroy()
    entry.server.close()
  }

  private armIdle(id: string): void {
    const entry = this.entries.get(id)
    if (!entry || entry.sockets.size > 0 || entry.idle) return
    entry.idle = setTimeout(() => this.closeEntry(id), IDLE_MS)
    entry.idle.unref?.()
  }

  private pipe(socket: Socket, node: TunnelNode, target: TunnelKey, id: string, head: Buffer): void {
    const url = new URL('/v2/tunnel', node.endpoint)
    url.protocol = 'wss:'
    url.searchParams.set('task', target.taskId)
    url.searchParams.set('port', String(target.port))
    const ws = new WebSocket(url, {
      headers: { authorization: `Bearer ${node.token}` },
      // The same pinning helper the broker's HTTPS agent uses: one definition of "is this the node
      // we paired with".
      ...pinnedTlsOptions(node.fingerprint, node.certPem),
    })
    ws.binaryType = 'nodebuffer'

    // Paused immediately: the socket is accepted before the WebSocket handshake finishes, so the
    // first bytes of the request would otherwise be dropped. Pausing pushes backpressure onto the
    // kernel instead of buffering without bound. `head`, bounded by MAX_HEAD_BYTES, is the one
    // exception: the credential check already consumed those bytes, so something has to replay them.
    socket.pause()

    const closeBoth = (): void => {
      socket.destroy()
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close()
    }

    ws.on('open', () => {
      // Resumed only after head is sent, so the request the browser already sent reaches the dev
      // server before anything that follows it on the same connection.
      ws.send(head, () => socket.resume())
    })
    ws.on('message', (data: Buffer) => {
      if (!socket.write(data)) ws.pause()
    })
    socket.on('drain', () => ws.resume())
    socket.on('data', (chunk: Buffer) => {
      // Backpressure by callback, matching the node side: stop reading from the browser until the
      // frame reaches the socket, so a slow link cannot grow an unbounded queue in main.
      socket.pause()
      ws.send(chunk, () => socket.resume())
    })
    ws.on('close', closeBoth)
    ws.on('error', (error) => {
      // A refused upgrade is the normal failure here (an undeclared port, a dev server that is not
      // running), and it must not be silent, or the preview pane shows a blank page with no
      // explanation.
      console.warn(`[tunnel] ${id}:`, error.message)
      closeBoth()
    })
    socket.on('close', closeBoth)
    socket.on('error', closeBoth)
  }
}
