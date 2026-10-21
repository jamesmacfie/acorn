import type { Agent as HttpAgent } from 'node:http'
import type { Agent as HttpsAgent } from 'node:https'
import type { NodeFetchRequest, NodeFetchResponse } from '@acorn/protocol/broker.ts'
import { apiRouteNamespace, parseTraceparent } from '@acorn/protocol/telemetry.ts'
import { measure, recordDuration, runWithTelemetry } from '@acorn/node-core/server/telemetry'
import { nodeRequest, NodeResponseTooLargeError } from './nodeRequest'

const DEFAULT_TIMEOUT_MS = 30_000
type Target = { node: { endpoint: string; token: string }; agent: HttpAgent | HttpsAgent }
type Health = { result(response: NodeFetchResponse): void; failure(error: unknown): void }

const countAll = (lists: NodeJS.ReadOnlyDict<readonly unknown[]>): number =>
  Object.values(lists).reduce((sum, list) => sum + (list?.length ?? 0), 0)

/** Request handles and deadlines, independent of WebSocket health and viewer identity. */
export class BrokerFetch {
  private readonly inFlight = new Map<string, AbortController>()

  async fetch(
    nodeId: string,
    request: NodeFetchRequest,
    target: Target,
    health: Health,
    limits: { maxResponseBytes?: number } = {},
  ): Promise<NodeFetchResponse> {
    if (this.inFlight.has(request.requestId)) throw new Error('A request with this transport ID is already in flight.')
    const controller = new AbortController()
    this.inFlight.set(request.requestId, controller)
    let timedOut = false
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const labels = { 'node.id': nodeId, method: request.method ?? 'GET' }
    // Sockets in use and requests waiting, read before this request joins the pool.
    const pool = { 'pool.active': countAll(target.agent.sockets), 'pool.queued': countAll(target.agent.requests) }
    const started = performance.now()
    let socketAt: number | undefined
    // The wait for a socket, which a full pool makes long. A request that never got one waited throughout.
    const queueMs = () => (socketAt ?? performance.now()) - started
    const send = () =>
      measure(
        'core',
        'broker.request',
        () =>
          nodeRequest({
            url: new URL(request.path, target.node.endpoint),
            method: request.method ?? 'GET',
            headers: { ...request.headers, authorization: `Bearer ${target.node.token}` },
            body: request.body,
            agent: target.agent,
            signal: controller.signal,
            maxResponseBytes: limits.maxResponseBytes ?? request.maxResponseBytes,
            onSocket: () => (socketAt = performance.now()),
          }),
        labels,
        () => ({ route: apiRouteNamespace(request.path), 'queue.ms': queueMs(), ...pool }),
      )
    // Inside the renderer's trace, a slow request becomes a span beside the Node's own `http.request`,
    // so the trace shows how much of the wait was the queue.
    const parent = parseTraceparent(request.headers?.traceparent)
    try {
      const response = await (parent
        ? runWithTelemetry({ traceId: parent.traceId, spanId: parent.parentSpanId, owner: 'core' }, send)
        : send())
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
      recordDuration('core', 'broker.queue', queueMs(), labels)
      clearTimeout(timeout)
      if (this.inFlight.get(request.requestId) === controller) this.inFlight.delete(request.requestId)
    }
  }

  abort(requestId: string): void {
    this.inFlight.get(requestId)?.abort()
  }
  dispose(): void {
    for (const controller of this.inFlight.values()) controller.abort()
    this.inFlight.clear()
  }
}
