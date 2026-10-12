import type { NodeStatus } from '@acorn/protocol/broker.ts'
import type { BridgeOperation, BridgeResults } from '@acorn/protocol/extensionBridge.ts'
import type { BrowserApi, Port } from '../browser'
import { CallFailure, type BackgroundMessage, type BridgeCall, type HostState } from '../messages'

export type BridgeClient = {
  call<Op extends BridgeOperation>(call: Extract<BridgeCall, { op: Op }>): Promise<BridgeResults[Op]>
}

// The sidebar's port to the background. Chrome may stop an idle service worker, which closes the port;
// the next call opens a new one, and calls caught by the close fail rather than wait forever.
export function bridgeClient(
  api: BrowserApi,
  events: { host(host: HostState): void; status(status: NodeStatus): void },
): BridgeClient {
  let port: Port | null = null
  let next = 0
  const pending = new Map<string, { resolve(result: unknown): void; reject(error: CallFailure): void }>()

  const open = (): Port => {
    if (port) return port
    const opened = api.runtime.connect({ name: 'sidebar' })
    port = opened
    opened.onMessage.addListener((raw) => {
      const message = raw as BackgroundMessage
      if (message.type === 'host') return events.host(message.host)
      if (message.type === 'status') return events.status(message.status)
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      if (message.ok) request.resolve(message.result)
      else request.reject(new CallFailure(message.error.code, message.error.message))
    })
    opened.onDisconnect.addListener(() => {
      if (port === opened) port = null
      for (const [id, request] of pending) {
        pending.delete(id)
        request.reject(new CallFailure('host_unavailable', 'The extension restarted. Try again.'))
      }
    })
    return opened
  }

  return {
    call(call) {
      const target = open()
      const id = String(++next)
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve: resolve as (result: unknown) => void, reject })
        target.postMessage({ id, call })
      })
    },
  }
}
