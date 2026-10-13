import type { NodeStatus } from '@acorn/protocol/broker.ts'
import type {
  BridgeAgentHint,
  BridgeErrorCode,
  BridgePendingRequest,
  BridgeRequest,
} from '@acorn/protocol/extensionBridge.ts'
import type { PageHandoff } from './handoffs'

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

// One conversation a waiting request belongs to, which the sidebar opens.
export type RequestTarget = { nodeId: string; projectId: string; taskId: string; sessionId: string }

export type BackgroundMessage =
  | { type: 'reply'; id: string; ok: true; result: unknown }
  | { type: 'reply'; id: string; ok: false; error: CallError }
  | { type: 'status'; status: NodeStatus }
  | { type: 'agent'; hint: BridgeAgentHint }
  | { type: 'host'; host: HostState }
  // A site button was clicked. The sidebar resolves it; nothing is sent to an agent.
  | { type: 'handoff'; handoff: PageHandoff }
  // The selected Node's plugins changed, so the sidebar reads its handoffs again.
  | { type: 'handoffs'; nodeId: string }
  // A project on the selected Node changed, so the sidebar reads its site associations again.
  | { type: 'projects'; nodeId: string }
  // The toolbar button was clicked, which can let the sidebar read the active page it couldn't before.
  | { type: 'page' }
  // Every request the selected Node's agents are waiting on, as the badge counts them. The sidebar shows
  // those for its own page or project.
  | { type: 'requests'; nodeId: string | null; requests: BridgePendingRequest[] }
  // An OS notification was clicked: open that request's conversation.
  | { type: 'open'; target: RequestTarget }

// Failures after which a write may or may not have reached the Node. The sidebar reads again and
// leaves any retry to the person.
const UNCERTAIN: ReadonlySet<CallErrorCode> = new Set(['ambiguous_mutation', 'host_unavailable', 'node_unreachable'])
export const isUncertain = (code: CallErrorCode): boolean => UNCERTAIN.has(code)

export class CallFailure extends Error {
  constructor(
    readonly code: CallErrorCode,
    message: string,
  ) {
    super(message)
  }
}
