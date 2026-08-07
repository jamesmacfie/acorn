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
export type TunnelKey = { nodeId: string; taskId: string; port: number }

export type TunnelNode = {
  // Where the node is listening, as reported at start/pairing — never assumed. The port is ephemeral.
  endpoint: string
  token: string
  // The pinned certificate, used as the CA. Absent only for a node paired before certificates were
  // remembered, in which case a tunnel cannot be opened safely and is refused rather than downgraded.
  certPem?: string
  fingerprint?: string
}

type Entry = { server: Server; port: number; sockets: Set<Socket> }

const key = ({ nodeId, taskId, port }: TunnelKey): string => `${nodeId}|${taskId}|${port}`

export class PreviewTunnels {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly resolve: (nodeId: string) => TunnelNode | null) {}

  // Idempotent: the preview pane calls this every time its URL is reconciled, so a second call for the same
  // (node, task, port) must return the port already listening rather than leaking a listener per render.
  async open(target: TunnelKey): Promise<number> {
    const existing = this.entries.get(key(target))
    if (existing) return existing.port

    const node = this.resolve(target.nodeId)
    if (!node) throw new Error('That node is not paired.')
    // No pin, no tunnel. Every other path to a node goes through the broker's pinned agent, and a raw byte
    // pipe is the last place to make an exception — an unpinned tunnel would trust whatever answered.
    if (!node.certPem) throw new Error('That node has no pinned certificate on this device; pair it again.')

    const sockets = new Set<Socket>()
    const server = createServer((socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      this.pipe(socket, node, target)
    })
    // 127.0.0.1 explicitly. Binding 0.0.0.0 would publish another machine's dev server to the local
    // network, which is the opposite of what the tunnel is for.
    const port = await new Promise<number>((resolvePort, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolvePort((server.address() as { port: number }).port))
    })
    server.on('error', (error) => console.warn(`[tunnel] listener for ${key(target)} failed:`, error))
    this.entries.set(key(target), { server, port, sockets })
    return port
  }

  // Close every tunnel for a node (unpaired, revoked) or for a task (archived). Both are the events after
  // which a live pipe to that dev server is either impossible or unwanted.
  closeFor(match: { nodeId?: string; taskId?: string }): void {
    for (const [id, entry] of [...this.entries]) {
      const [nodeId, taskId] = id.split('|')
      if (match.nodeId && nodeId !== match.nodeId) continue
      if (match.taskId && taskId !== match.taskId) continue
      this.entries.delete(id)
      for (const socket of entry.sockets) socket.destroy()
      entry.server.close()
    }
  }

  dispose(): void {
    this.closeFor({})
  }

  private pipe(socket: Socket, node: TunnelNode, target: TunnelKey): void {
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

    // Buffer whatever the browser sends before the upgrade completes. Without this the first bytes of an
    // HTTP request are dropped and the page simply never loads — the socket is accepted locally the moment
    // Chromium connects, which is before the WebSocket handshake has finished.
    const pending: Buffer[] = []
    let open = false

    const closeBoth = (): void => {
      socket.destroy()
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close()
    }

    ws.on('open', () => {
      open = true
      for (const chunk of pending.splice(0)) ws.send(chunk)
    })
    ws.on('message', (data: Buffer) => {
      if (!socket.write(data)) ws.pause()
    })
    socket.on('drain', () => ws.resume())
    socket.on('data', (chunk: Buffer) => {
      if (!open) {
        pending.push(chunk)
        return
      }
      // Backpressure by callback, matching the node side: pause reading from the browser until the frame
      // has been handed to the socket, so a slow link cannot grow an unbounded queue in main.
      socket.pause()
      ws.send(chunk, () => socket.resume())
    })
    ws.on('close', closeBoth)
    ws.on('error', (error) => {
      // A refused upgrade is the normal failure here — an undeclared port, a dev server that is not
      // running — and it must not be silent, or the preview pane shows a blank page with no explanation.
      console.warn(`[tunnel] ${key(target)}:`, error.message)
      closeBoth()
    })
    socket.on('close', closeBoth)
    socket.on('error', closeBoth)
  }
}
