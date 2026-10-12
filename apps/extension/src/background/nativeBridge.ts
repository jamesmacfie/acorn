import type { NodeStatus } from '@acorn/protocol/broker.ts'
import {
  BROWSER_BRIDGE_PROTOCOL_VERSION,
  NATIVE_REPLY_MAX_CHARS,
  type BridgeOperation,
  type BridgeResults,
} from '@acorn/protocol/extensionBridge.ts'
import { disconnectReason, type BrowserApi, type Port } from '../browser'
import { CallFailure, type BridgeCall, type HostState } from '../messages'

type Pending = {
  resolve(result: unknown): void
  reject(error: CallFailure): void
  // A reply arriving in chunks. Bounded by NATIVE_REPLY_MAX_CHARS and dropped if the port closes.
  chunks?: { count: number; parts: string[]; received: number; chars: number }
}

// How long a new port may stay silent before it is closed. Firefox 151 has been seen to leave a port
// opened just after the browser starts with no host process and no disconnect, which would hang every
// later call. Longer than the host's 8-second probe deadline, so a slow first probe still answers.
const FIRST_REPLY_MS = 10_000

// The background's one native port. Opened on first use and again after the host exits, never
// retried on its own: a missing host stays missing until the person installs it.
export function nativeBridge(
  api: BrowserApi,
  hostName: string,
  events: { status(status: NodeStatus): void; host(state: Pick<HostState, 'state' | 'message'>): void },
  options: { firstReplyMs?: number } = {},
) {
  let port: Port | null = null
  let silence: ReturnType<typeof setTimeout> | undefined
  const pending = new Map<string, Pending>()

  const settle = (id: string, outcome: { result: unknown } | { error: CallFailure }): void => {
    const request = pending.get(id)
    if (!request) return
    pending.delete(id)
    if ('error' in outcome) request.reject(outcome.error)
    else request.resolve(outcome.result)
  }

  const receive = (message: unknown): void => {
    if (!message || typeof message !== 'object' || (message as { v?: unknown }).v !== BROWSER_BRIDGE_PROTOCOL_VERSION)
      return
    clearTimeout(silence)
    events.host({ state: 'connected', message: null })
    const value = message as Record<string, unknown>
    if (value.event === 'status') return events.status(value.status as NodeStatus)
    if (typeof value.id !== 'string') return
    if (value.chunk) return receiveChunk(value.id, value.chunk as { index: number; count: number; data: string })
    if (value.ok === true) settle(value.id, { result: value.result })
    else {
      const error = value.error as { code?: string; message?: string } | undefined
      settle(value.id, {
        error: new CallFailure(
          (error?.code ?? 'node_error') as CallFailure['code'],
          error?.message ?? 'The bridge failed.',
        ),
      })
    }
  }

  const receiveChunk = (id: string, chunk: { index: number; count: number; data: string }): void => {
    const request = pending.get(id)
    if (!request) return
    const assembly = (request.chunks ??= { count: chunk.count, parts: [], received: 0, chars: 0 })
    assembly.chars += typeof chunk.data === 'string' ? chunk.data.length : Infinity
    if (
      chunk.count !== assembly.count ||
      !Number.isInteger(chunk.index) ||
      chunk.index < 0 ||
      chunk.index >= assembly.count ||
      assembly.parts[chunk.index] !== undefined ||
      assembly.chars > NATIVE_REPLY_MAX_CHARS
    )
      return settle(id, { error: new CallFailure('reply_too_large', 'The bridge sent a reply this sidebar refuses.') })
    assembly.parts[chunk.index] = chunk.data
    if (++assembly.received < assembly.count) return
    request.chunks = undefined
    try {
      receive(JSON.parse(assembly.parts.join('')))
    } catch {
      settle(id, { error: new CallFailure('reply_too_large', 'The bridge sent an unreadable reply.') })
    }
  }

  const open = (): Port => {
    if (port) return port
    const opened = api.runtime.connectNative(hostName)
    port = opened
    events.host({ state: 'connecting', message: null })
    const closed = (state: Pick<HostState, 'state' | 'message'>): void => {
      clearTimeout(silence)
      if (port === opened) port = null
      events.host(state)
      // Every unanswered request fails, and any half-assembled reply goes with it.
      for (const id of pending.keys())
        settle(id, { error: new CallFailure('host_unavailable', state.message ?? 'The bridge closed.') })
    }
    opened.onMessage.addListener(receive)
    opened.onDisconnect.addListener(() => closed(hostState(disconnectReason(api, opened))))
    silence = setTimeout(() => {
      opened.disconnect()
      closed({ state: 'exited', message: 'The bridge did not answer.' })
    }, options.firstReplyMs ?? FIRST_REPLY_MS)
    return opened
  }

  return {
    // True when the next request will start the host, so the caller can restore state first.
    get closed() {
      return port === null
    },
    request<Op extends BridgeOperation>(call: Extract<BridgeCall, { op: Op }>): Promise<BridgeResults[Op]> {
      const target = open()
      const id = crypto.randomUUID()
      return new Promise<BridgeResults[Op]>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (result: unknown) => void, reject })
        target.postMessage({ v: BROWSER_BRIDGE_PROTOCOL_VERSION, id, ...call })
      })
    },
  }
}

// Chrome and Firefox word the same failures differently.
function hostState(reason: string | null): Pick<HostState, 'state' | 'message'> {
  if (reason && /not found|no such native application/i.test(reason))
    return { state: 'missing', message: 'The Acorn browser bridge is not installed.' }
  if (reason && /forbidden|not allowed/i.test(reason))
    return { state: 'forbidden', message: 'The installed bridge does not allow this extension.' }
  return { state: 'exited', message: reason ? `The bridge stopped: ${reason}` : 'The bridge stopped.' }
}
