import { randomUUID } from 'node:crypto'
import type { NodeFetchRequest } from '@acorn/protocol/broker.ts'
import type { WsClientFrame, WsSendOptions } from '@acorn/protocol/ws.ts'
import type { NodeBroker } from '@acorn/custody/broker'
import { encodeResponseBody } from './bodyCodec'

/** Request and event ownership for one authenticated renderer socket. */
export class RendererConnection {
  readonly viewerId = randomUUID()
  activeNode: string | null | undefined
  closed = false
  private readonly requests = new Map<string, string>()
  private readonly nodes = new Set<string>()

  constructor(private readonly broker: NodeBroker) {}

  interestedIn(nodeId: string): boolean { return !this.closed && (this.activeNode === undefined || this.activeNode === nodeId) }

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
    if (previous && previous !== nodeId) { this.broker.closeViewer(previous, this.viewerId); this.nodes.delete(previous) }
    if (nodeId && this.broker.openViewer(nodeId, this.viewerId)) this.nodes.add(nodeId)
  }

  forget(nodeId: string): void {
    this.nodes.delete(nodeId)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const requestId of this.requests.values()) this.broker.abort(requestId)
    this.requests.clear()
    for (const nodeId of this.nodes) this.broker.closeViewer(nodeId, this.viewerId)
    this.nodes.clear()
  }
}
