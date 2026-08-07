import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server, type Socket } from 'node:net'
import { WebSocket } from 'ws'
import { pinnedTlsOptions } from './nodeBroker'

export type TunnelKey = { nodeId: string; taskId: string; port: number }

export type TunnelNode = {
  // Where the node is listening, as reported at start/pairing — never assumed. The port is ephemeral.
  endpoint: string
  token: string
  // The pinned certificate and its fingerprint. `pinnedTlsOptions` degrades to no pinning at all unless
  // BOTH are present, so both are required here rather than just the certificate.
  certPem?: string
  fingerprint?: string
}

// A listener with no live connection is reaped. The pane closes its own tunnels on unmount, so this is the
// backstop for the paths that do not run a cleanup — a crashed renderer, a window closed abruptly.
const IDLE_MS = 60_000

// A ceiling on how much a compromised renderer can ask main to open. nodeBrokerIpc.ts's header says the
// renderer is treated as a trust boundary because it is the part of the system that renders third-party
// content; without a cap, `nodeTunnelOpen` in a loop exhausts this process's file descriptors.
const MAX_TUNNELS = 16

// The header the pane's session attaches and this listener demands. Lower-case because that is how both
// Chromium and `Buffer.toString()` scanning below will see it; the check is case-insensitive anyway.
const TUNNEL_HEADER = 'x-acorn-tunnel'

// How long a connection has to produce a complete request head, and how much of one we will hold while
// it does. Both exist so an unauthenticated peer cannot pin memory or a file descriptor by connecting and
// saying nothing — the same class of bound as MAX_TUNNELS, applied one level down.
const HEAD_TIMEOUT_MS = 2_000
const MAX_HEAD_BYTES = 8 * 1024

type Entry = {
  server: Server
  port: number
  sockets: Set<Socket>
  idle: ReturnType<typeof setTimeout> | null
  // Per LISTENER, not per connection: the pane's session attaches it by destination port, and a
  // per-connection value would need a channel to tell the pane about that this design does not have.
  secret: string
}

// Case-insensitive scan of a request head for `x-acorn-tunnel: <secret>`.
//
// A hand-rolled scan rather than a parser because the only question is whether one exact value is
// present, and `timingSafeEqual` on a length-checked pair is the comparison that question deserves —
// the secret is 256 bits of `randomBytes`, so an attacker's leverage is guessing, not timing, but a
// `===` here would be the kind of thing a later reader has to re-derive.
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
  // In-flight opens, so two overlapping calls for the same key share one listener. `open` awaits `listen`
  // before recording the entry, so without this both calls missed the map, both bound a listener, and the
  // second `set` orphaned the first — a leaked listener with no entry, which `closeFor` and `dispose` could
  // never reap. The preview pane's `createResource` re-runs whenever its URL is reconciled, so overlapping
  // calls are the normal case rather than a race to shrug at.
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
    // Probed here only to fail early with a useful message. Every CONNECTION re-resolves, because a
    // restart or a re-pair changes the endpoint, the token and the certificate.
    if (!this.resolve(target.nodeId)) throw new Error('That node is not paired.')

    const sockets = new Set<Socket>()
    // 32 bytes of CSPRNG, base64url'd so it is a legal header value with no escaping question.
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
      // Resolve the current node record for every connection so restarts and re-pairing use the active
      // endpoint, token, and certificate.
      const node = this.resolve(target.nodeId)
      if (!node?.certPem || !node.fingerprint) {
        // No pin, no tunnel. Every other path to a node goes through the broker's pinned agent, and a raw
        // byte pipe is the last place to make an exception. Both halves are required because
        // `pinnedTlsOptions` silently degrades to no pinning when either is missing.
        console.warn(`[tunnel] ${id}: no pinned certificate for this node; refusing`)
        socket.destroy()
        return
      }
      // The credential check happens HERE, before anything dials the node — so an unauthorised connection
      // costs one destroyed socket rather than an upgrade against the owner's device token.
      this.authorize(socket, secret, id, (head) => this.pipe(socket, node, target, id, head))
    })
    // 127.0.0.1 explicitly. Binding 0.0.0.0 would publish another machine's dev server to the local
    // network, which is the opposite of what the tunnel is for.
    const port = await new Promise<number>((resolvePort, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolvePort((server.address() as { port: number }).port))
    })
    server.on('error', (error) => {
      // A dead listener must not stay in the map: a later `open()` would return a port nothing is on.
      console.warn(`[tunnel] listener for ${id} failed:`, error)
      this.closeEntry(id)
    })
    this.entries.set(id, { server, port, sockets, idle: null, secret })
    this.armIdle(id)
    return port
  }

  // The headers a preview pane must attach to reach a tunnel, or null when the URL is not one of ours.
  //
  // This is how the secret reaches the WebContentsView without the plugin that owns the view importing
  // this file — plugins may not import an app (tools/arch/boundaries.test.ts). It goes in as an injected
  // function, exactly the way `loadRules` already does (plugins/preview/src/main/previewService.ts).
  // Returning the whole header record rather than a bare value keeps the header NAME here too, so there
  // is no constant for the two sides to disagree about.
  headersFor(url: string): Record<string, string> | null {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return null
    }
    // Loopback only, and by exact host: a page served through the tunnel can link anywhere, and attaching
    // the secret to an outbound request to a third party would hand it away.
    if (parsed.hostname !== '127.0.0.1') return null
    const port = Number(parsed.port)
    for (const entry of this.entries.values()) {
      if (entry.port === port) return { [TUNNEL_HEADER]: entry.secret }
    }
    return null
  }

  // Read the request head, check the secret, hand the bytes on. The head is forwarded VERBATIM, including
  // the secret header: a dev server ignores a header it does not know, and rewriting the request would
  // mean re-serialising it and owning every edge of HTTP framing to no benefit.
  private authorize(socket: Socket, secret: string, id: string, onAuthorized: (head: Buffer) => void): void {
    let buffered = Buffer.alloc(0)
    const refuse = (reason: string): void => {
      clearTimeout(timer)
      socket.off('data', onData)
      console.warn(`[tunnel] ${id}: ${reason}; refusing`)
      socket.destroy()
    }
    // A peer that connects and says nothing must not hold a socket open indefinitely.
    const timer = setTimeout(() => refuse('no request head within the deadline'), HEAD_TIMEOUT_MS)
    timer.unref?.()
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk])
      // `latin1` rather than `utf8`: header bytes are a byte protocol, and a decoder that can produce a
      // replacement character could make two different byte strings compare equal.
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
      // Everything read so far, not just the head: a POST's body can arrive in the same packet, and
      // dropping it would corrupt the request we just authorised.
      onAuthorized(buffered)
    }
    socket.on('data', onData)
  }

  // Close every tunnel for a node (unpaired, revoked, restarted) or for a task (pane unmounted, archived).
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
      // The same pinning the broker's HTTPS agent uses, from the same helper — one definition of "is this
      // the node we paired with".
      ...pinnedTlsOptions(node.fingerprint, node.certPem),
    })
    ws.binaryType = 'nodebuffer'

    // PAUSED until the upgrade completes, rather than buffering.
    //
    // The socket is accepted the moment Chromium connects, which is before the WebSocket handshake has
    // finished, so the first bytes of the HTTP request would otherwise be dropped. Pausing pushes
    // backpressure onto the kernel and avoids unbounded buffering while the WebSocket opens.
    //
    // `head` is the ONE exception, and it is bounded by MAX_HEAD_BYTES rather than unbounded: those bytes
    // were consumed by the credential check above, so they no longer exist as far as the socket is
    // concerned, and something has to replay them.
    socket.pause()

    const closeBoth = (): void => {
      socket.destroy()
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close()
    }

    ws.on('open', () => {
      // Before resume(), so the request the browser already sent reaches the dev server ahead of anything
      // that follows it on the same connection.
      ws.send(head, () => socket.resume())
    })
    ws.on('message', (data: Buffer) => {
      if (!socket.write(data)) ws.pause()
    })
    socket.on('drain', () => ws.resume())
    socket.on('data', (chunk: Buffer) => {
      // Backpressure by callback, matching the node side: stop reading from the browser until the frame has
      // been handed to the socket, so a slow link cannot grow an unbounded queue in main.
      socket.pause()
      ws.send(chunk, () => socket.resume())
    })
    ws.on('close', closeBoth)
    ws.on('error', (error) => {
      // A refused upgrade is the normal failure here — an undeclared port, a dev server that is not
      // running — and it must not be silent, or the preview pane shows a blank page with no explanation.
      console.warn(`[tunnel] ${id}:`, error.message)
      closeBoth()
    })
    socket.on('close', closeBoth)
    socket.on('error', closeBoth)
  }
}
