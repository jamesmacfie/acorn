import { createServer, type Server, type Socket } from 'node:net'
import { WebSocket } from 'ws'
import { pinnedTlsOptions } from './nodeBroker'

// The client end of the preview tunnel (docs/vNext/protocol.md § Streams: "The client end terminates in a
// local loopback listener created by the connection broker, which is what a remote task's preview pane
// points its WebContentsView at").
//
// One `net` listener per (node, task, port), on 127.0.0.1:0. Each accepted TCP connection opens its own
// pinned WebSocket to the node's `/v2/tunnel` and pipes. That per-connection shape is what makes the
// preview pane work at all: a browser opens many sockets to a dev server — assets, XHR, an HMR
// WebSocket — and multiplexing them over one pipe would need a framing layer and head-of-line handling
// that `net` and `ws` already provide for free.
//
// It lives in main, not the renderer, for the same reason every other node request does: the device token
// and the pinned certificate are here, and the renderer has no network permission at all under its CSP.
// The renderer only ever learns a loopback port number.
//
// ## The listener is UNAUTHENTICATED, and that is the honest limit of this design
//
// A raw TCP listener carries no credential, so any process on this machine that finds the port can speak to
// the node's declared dev port through it. security.md § Threat model puts "a compromised machine
// (root/other-user access)" out of scope, but this is still a genuine widening: before the tunnel, reaching
// a remote node needed the device token, which lives in main and the OS keychain. Three things bound it,
// and none of them is authentication:
//
//   - **Only declared ports.** The node refuses anything the owner has not configured as that task's
//     preview or run URL (node-core's main/tunnelPorts.ts).
//   - **Only while the pane is open.** The pane closes its tunnels on unmount, and a listener with no
//     connections is reaped after IDLE_MS, so the surface is not ambient.
//   - **A bounded number.** MAX_TUNNELS caps what a compromised renderer can ask for.
//
// A credential would need the loopback hop to carry one, which means the WebContentsView carrying it — a
// cookie or a header it does not control. Recorded in docs/vNext/phase4-notes.md rather than pretended away.
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

type Entry = { server: Server; port: number; sockets: Set<Socket>; idle: ReturnType<typeof setTimeout> | null }

const key = ({ nodeId, taskId, port }: TunnelKey): string =>
  // Encoded, so a taskId containing the delimiter cannot forge or evade a key. The IPC schema validates
  // `taskId` only as a non-empty string, and `closeFor` recovers the parts by splitting — so `real|evil`
  // used to produce a key that a close for `real` matched and a close for `real|evil` never did, leaking an
  // unauthenticated listener.
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
      // Resolved PER CONNECTION, not once in `open`. The first version closed over the node record, so after
      // a node restart (Settings → Plugins' Restart button, or crash recovery) every later connection dialled
      // the old ephemeral port with the old token — and bootstrap.ts claimed the opposite in a comment.
      const node = this.resolve(target.nodeId)
      if (!node?.certPem || !node.fingerprint) {
        // No pin, no tunnel. Every other path to a node goes through the broker's pinned agent, and a raw
        // byte pipe is the last place to make an exception. Both halves are required because
        // `pinnedTlsOptions` silently degrades to no pinning when either is missing.
        console.warn(`[tunnel] ${id}: no pinned certificate for this node; refusing`)
        socket.destroy()
        return
      }
      this.pipe(socket, node, target, id)
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
    this.entries.set(id, { server, port, sockets, idle: null })
    this.armIdle(id)
    return port
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

  private pipe(socket: Socket, node: TunnelNode, target: TunnelKey, id: string): void {
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
    // finished, so the first bytes of the HTTP request would otherwise be dropped. The first version queued
    // them in an unbounded array — a local process could stream into main's heap without limit while the ws
    // never opened. Pausing pushes the backpressure onto the kernel, which is where it belongs, and deletes
    // the buffer instead of capping it.
    socket.pause()

    const closeBoth = (): void => {
      socket.destroy()
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close()
    }

    ws.on('open', () => socket.resume())
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
