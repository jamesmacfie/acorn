import { randomUUID } from 'node:crypto'
import type { NodeFetchRequest } from '@acorn/protocol/broker.ts'
import type { WsClientFrame, WsSendOptions } from '@acorn/protocol/ws.ts'
import { openPreviewListener, type NodeBroker, type PreviewListener } from '@acorn/custody/broker'
import { encodeResponseBody } from './bodyCodec'

/** Request and event ownership for one authenticated renderer socket. */
export class RendererConnection {
  readonly viewerId = randomUUID()
  activeNode: string | null | undefined
  closed = false
  private readonly requests = new Map<string, string>()
  private readonly nodes = new Set<string>()
  // A remote Node's previews, one listener per task, kept until the pane closes it, the Node is forgotten, or this
  // renderer goes. Held as the promise, so a second open while the first is starting gets the same listener.
  private readonly previews = new Map<string, { nodeId: string; listener: Promise<PreviewListener> }>()

  constructor(private readonly broker: NodeBroker) {}

  interestedIn(nodeId: string): boolean {
    return !this.closed && (this.activeNode === undefined || this.activeNode === nodeId)
  }

  async fetch(nodeId: string, request: NodeFetchRequest): Promise<unknown> {
    if (this.closed) return null
    if (this.requests.has(request.requestId)) throw new Error('This renderer request ID is already in flight.')
    const requestId = `${this.viewerId}:${request.requestId}`
    this.requests.set(request.requestId, requestId)
    try {
      const response = await this.broker.fetch(nodeId, { ...request, requestId })
      if (this.closed) return null
      return { status: response.status, headers: response.headers, body: encodeResponseBody(response.body) }
    } catch (error) {
      if ((error as { name?: unknown } | null)?.name === 'AbortError') return { status: 499, headers: {}, body: '' }
      throw error
    } finally {
      if (this.requests.get(request.requestId) === requestId) this.requests.delete(request.requestId)
    }
  }

  abort(requestId: string): void {
    const owned = this.requests.get(requestId)
    if (owned) this.broker.abort(owned)
  }

  send(nodeId: string, frame: WsClientFrame, options: WsSendOptions): void {
    if (this.closed) return
    if (this.broker.send(nodeId, frame, { ...options, viewerId: this.viewerId })) this.nodes.add(nodeId)
  }

  select(nodeId: string | null): void {
    if (this.closed) return
    const previous = this.activeNode
    this.activeNode = nodeId
    if (previous && previous !== nodeId) {
      this.broker.closeViewer(previous, this.viewerId)
      this.nodes.delete(previous)
    }
    if (nodeId && this.broker.openViewer(nodeId, this.viewerId)) this.nodes.add(nodeId)
  }

  // Idempotent per task, so a pane that asks again keeps its page, and its origin, as they were.
  async openPreview(
    nodeId: string,
    taskId: string,
    route: string,
    path: string,
  ): Promise<{ origin: string; entry: string }> {
    if (this.closed) throw new Error('This window has closed.')
    const key = `${nodeId}\n${taskId}`
    let preview = this.previews.get(key)
    if (!preview) {
      preview = { nodeId, listener: openPreviewListener(this.broker.previewTransport(nodeId), route) }
      this.previews.set(key, preview)
      preview.listener.catch(() => this.previews.delete(key))
    }
    const listener = await preview.listener
    return { origin: listener.origin, entry: listener.entry(path) }
  }

  closePreview(nodeId: string, taskId: string): void {
    this.dropPreview(`${nodeId}\n${taskId}`)
  }

  forget(nodeId: string): void {
    this.nodes.delete(nodeId)
    for (const [key, preview] of this.previews) if (preview.nodeId === nodeId) this.dropPreview(key)
  }

  private dropPreview(key: string): void {
    void this.previews.get(key)?.listener.then(
      (listener) => listener.close(),
      () => undefined,
    )
    this.previews.delete(key)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const requestId of this.requests.values()) this.broker.abort(requestId)
    this.requests.clear()
    for (const nodeId of this.nodes) this.broker.closeViewer(nodeId, this.viewerId)
    this.nodes.clear()
    for (const key of this.previews.keys()) this.dropPreview(key)
  }
}
