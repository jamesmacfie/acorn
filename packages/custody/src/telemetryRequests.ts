import type { NodeBroker } from './broker/nodeBroker'

/** Requests belong to one adoption/consent generation, including every batch in a split post. */
export function helperTelemetryRequests(broker: NodeBroker, nodeId: string, nextId: () => string) {
  const pending = new Map<string, { method: string; cancel(): void }>()
  let closed = false
  const cancel = (method?: string): void => {
    for (const request of pending.values()) {
      if (!method || request.method === method) request.cancel()
    }
  }
  return {
    close(): void { closed = true; cancel() },
    cancelReads(): void { cancel('GET') },
    async ask(path: string, init: { method: string; body?: string }): Promise<{ status: number; text: string }> {
      if (closed) throw new Error('telemetry owner retired')
      const requestId = nextId()
      let timer: ReturnType<typeof setTimeout> | undefined
      let rejectCancellation: (error: Error) => void = () => {}
      const cancelled = new Promise<never>((_, reject) => { rejectCancellation = reject })
      const retire = () => {
        if (!pending.delete(requestId)) return
        if (timer) clearTimeout(timer)
        rejectCancellation(new Error('telemetry request cancelled'))
        // The broker only receives this owner's request ID. Cancellation also settles mocks or
        // transports that cannot complete their own fetch promise after abort.
        try { broker.abort?.(requestId) } catch { /* Telemetry cancellation cannot fail shutdown. */ }
      }
      pending.set(requestId, { method: init.method, cancel: retire })
      timer = setTimeout(retire, 10_000)
      timer.unref?.()
      try {
        const response = await Promise.race([cancelled, broker.fetch(nodeId, {
          requestId,
          path,
          method: init.method,
          headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
          ...(init.body === undefined ? {} : { body: { kind: 'bytes' as const, bytes: new TextEncoder().encode(init.body) } }),
        })])
        return { status: response.status, text: new TextDecoder().decode(response.body) }
      } finally {
        if (timer) clearTimeout(timer)
        pending.delete(requestId)
      }
    },
  }
}
export type HelperTelemetryRequests = ReturnType<typeof helperTelemetryRequests>
