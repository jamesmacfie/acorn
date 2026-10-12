import type { NodeStatus } from '@acorn/protocol/broker.ts'
import type { BridgeAgentHint, BridgeErrorCode, BridgeRequest } from '@acorn/protocol/extensionBridge.ts'

// Between the sidebar and the background. The background owns the one native connection, so the
// sidebar names an operation and the background adds the protocol envelope.

type WithoutEnvelope<Request> = Request extends unknown ? Omit<Request, 'v' | 'id'> : never
export type BridgeCall = WithoutEnvelope<BridgeRequest>

export type SidebarMessage = { id: string; call: BridgeCall }

// The extension's own failures sit beside the host's: the host isn't there, or a reply was refused.
export type CallErrorCode = BridgeErrorCode | 'host_unavailable' | 'reply_too_large'
export type CallError = { code: CallErrorCode; message: string }

// Whether the native host is reachable, and why not when it isn't. `restoreError` keeps a failed
// restore of the remembered selection visible without blocking pairing or forgetting.
export type HostState = {
  state: 'connecting' | 'connected' | 'missing' | 'forbidden' | 'exited'
  message: string | null
  restoreError: string | null
}

export type BackgroundMessage =
  | { type: 'reply'; id: string; ok: true; result: unknown }
  | { type: 'reply'; id: string; ok: false; error: CallError }
  | { type: 'status'; status: NodeStatus }
  | { type: 'agent'; hint: BridgeAgentHint }
  | { type: 'host'; host: HostState }

export class CallFailure extends Error {
  constructor(
    readonly code: CallErrorCode,
    message: string,
  ) {
    super(message)
  }
}
