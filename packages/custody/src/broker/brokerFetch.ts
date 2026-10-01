import type { Agent as HttpAgent } from 'node:http'
import type { Agent as HttpsAgent } from 'node:https'
import type { NodeFetchRequest, NodeFetchResponse } from '@acorn/protocol/broker.ts'
import { measure } from '@acorn/node-core/server/telemetry'
import { nodeRequest, NodeResponseTooLargeError } from './nodeRequest'

const DEFAULT_TIMEOUT_MS = 30_000
type Target = { node: { endpoint: string; token: string }; agent: HttpAgent | HttpsAgent }
type Health = { result(response: NodeFetchResponse): void; failure(error: unknown): void }

/** Request handles and deadlines, independent of WebSocket health and viewer identity. */
export class BrokerFetch {
  private readonly inFlight = new Map<string, AbortController>()

  async fetch(nodeId: string, request: NodeFetchRequest, target: Target, health: Health, limits: { maxResponseBytes?: number } = {}): Promise<NodeFetchResponse> {
    if (this.inFlight.has(request.requestId)) throw new Error('A request with this transport ID is already in flight.')
    const controller = new AbortController()
    this.inFlight.set(request.requestId, controller)
    let timedOut = false
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    try {
      const response = await measure('core', 'broker.request', () => nodeRequest({
        url: new URL(request.path, target.node.endpoint),
        method: request.method ?? 'GET',
        headers: { ...request.headers, authorization: `Bearer ${target.node.token}` },
        body: request.body,
        agent: target.agent,
        signal: controller.signal,
        maxResponseBytes: limits.maxResponseBytes ?? request.maxResponseBytes,
      }), { 'node.id': nodeId, method: request.method ?? 'GET' })
      health.result(response)
      return response
    } catch (error) {
      // Both aborts describe this request. Heartbeats, not a route deadline, own Node liveness.
      if ((error as { name?: unknown } | null)?.name === 'AbortError') {
        if (!timedOut) throw error
        throw Object.assign(new Error(`The node did not answer within ${timeoutMs}ms`), { name: 'TimeoutError' })
      }
      if (error instanceof NodeResponseTooLargeError) throw error
      health.failure(error)
      throw error
    } finally {
      clearTimeout(timeout)
      if (this.inFlight.get(request.requestId) === controller) this.inFlight.delete(request.requestId)
    }
  }

  abort(requestId: string): void { this.inFlight.get(requestId)?.abort() }
  dispose(): void { for (const controller of this.inFlight.values()) controller.abort(); this.inFlight.clear() }
}
