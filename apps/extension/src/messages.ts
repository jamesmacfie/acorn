import type { NodeStatus } from '@acorn/protocol/broker.ts'
import type {
  BridgeAgentChoice,
  BridgeAgentHint,
  BridgeErrorCode,
  BridgePageTask,
  BridgePendingRequest,
  BridgeRequest,
} from '@acorn/protocol/extensionBridge.ts'
import type { PageHandoff } from './handoffs'

// Between the sidebar and the background. The background owns the one native connection, so the
// sidebar names an operation and the background adds the protocol envelope.

type WithoutEnvelope<Request> = Request extends unknown ? Omit<Request, 'v' | 'id'> : never
export type BridgeCall = WithoutEnvelope<BridgeRequest>

export type SidebarMessage = { id: string; call: BridgeCall }

// Which row of `agents.choices` a new chat starts from: the harness, the login, and the custom agent.
export const choiceKey = (choice: BridgeAgentChoice): string =>
  [choice.providerId, choice.account ?? '', choice.customAgentId ?? ''].join(':')

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
  // A task chip was clicked on a page no task holds. The sidebar resolves it; nothing is sent to an agent.
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
  // Open a conversation: a waiting request's, from its OS notification, or the one a right-click
  // added a selection to.
  | { type: 'open'; target: RequestTarget }
  // Why a right-click added nothing, in one line.
  | { type: 'notice'; notice: string }
  // The selected Node's tasks and the page addresses each is known by.
  | { type: 'taskPages'; nodeId: string | null; tasks: BridgePageTask[] | null }
  // A task chip was clicked: show Home on the page's task, with a new chat about the page for `chat`.
  | { type: 'showTask'; chat: { url: string; title: string } | null }

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

// A reply refused because the selected Node changed under it, which is expected after a switch, or
// because the bridge is missing, which its own banner explains. Neither needs a line of its own.
export const expectedFailure = (error: unknown): boolean =>
  error instanceof CallFailure && (error.code === 'not_selected' || error.code === 'host_unavailable')
