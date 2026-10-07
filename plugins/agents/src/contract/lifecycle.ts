import type {
  AgentAttentionReason,
  AgentRequestBlocked,
  AgentRequestKind,
  AgentRequestStatus,
  AgentRuntimeState,
  AgentSessionKind,
  AgentTurnSource,
  AgentTurnStatus,
} from './wire.ts'
import { capabilityId } from '@acorn/protocol/plugin/ids.ts'

export type AgentTurnChangedEvent = {
  taskId: string
  sessionId: string
  turnId: string
  source: AgentTurnSource
  status: AgentTurnStatus
  attempt: number
}

export type AgentRequestChangedEvent = {
  taskId: string
  sessionId: string
  requestId: string
  kind: AgentRequestKind
  status: AgentRequestStatus
}

export type SessionRenameSource = 'generated' | 'user'
export type AgentSessionChange = 'created' | 'renamed' | 'archived' | 'restored' | 'deleted'

export type AgentSessionsChangedEvent = {
  taskId: string
  sessionId: string
  present: boolean
  archived: boolean
  changes: AgentSessionChange[]
  renameSource?: SessionRenameSource
}

export type AgentLifecycleFrame =
  | ({ channel: 'plugin:agents:turn-changed' } & AgentTurnChangedEvent)
  | ({ channel: 'plugin:agents:request-changed' } & AgentRequestChangedEvent)
  | ({ channel: 'plugin:agents:sessions-changed' } & AgentSessionsChangedEvent)

export type AgentLifecyclePublisher = (frame: AgentLifecycleFrame) => void

export type AgentTurnState = AgentTurnChangedEvent & {
  ordinal: number
  providerTurnRef: string | null
  stopReason: string | null
  createdAt: number
  startedAt: number | null
  completedAt: number | null
}

export type AgentRequestState = AgentRequestChangedEvent & {
  turnId: string | null
  title: string
  detail: string | null
  payload: Record<string, unknown>
  expiresAt: number | null
  createdAt: number
  resolvedAt: number | null
  /** Present on a resolved row a policy plugin refused at `agents:before-permission`. With `requestId`,
   *  it is how a consumer confirms its veto took effect; the handler's own verdict is not that proof. */
  blocked?: AgentRequestBlocked
}

export type AgentSessionRosterEntry = Omit<AgentSessionsChangedEvent, 'changes' | 'renameSource'> & {
  providerId: string
  profileId: string
  kind: AgentSessionKind
  title: string
  runtimeState: AgentRuntimeState
  attention: AgentAttentionReason
  createdAt: number
  updatedAt: number
}

type TaskSessionFilter = { taskId: string; sessionId?: string }

/** Read durable turn state within one task. Prompt, policy, error and transcript content stay out. */
export type AgentTurnsCapability = {
  list(filter: TaskSessionFilter): Promise<AgentTurnState[]>
}

/** Rebuild a task's request inbox. Resolution content remains private to the owning runtime. */
export type AgentRequestsCapability = {
  list(filter: TaskSessionFilter): Promise<AgentRequestState[]>
}

/** Rebuild one task's active and archived managed-session roster. */
export type AgentSessionsCapability = {
  list(taskId: string): Promise<AgentSessionRosterEntry[]>
}

/** Who wrote one piece of a reviewed turn's input. Only `person` is the person's own words. */
export type AgentReviewProvenance =
  | { kind: 'person' }
  /** Text in a turn the person didn't type, such as a plugin's note or a delegated agent's report. */
  | { kind: 'turn'; source: AgentTurnSource }
  /** An attached context snapshot: its source id, such as `plugin:acorn-permission-policy`, and label. */
  | { kind: 'context'; source: string; label: string }

export type AgentReviewText = { text: string; provenance: AgentReviewProvenance; truncated: boolean }

/** One completed turn, bounded. No ledger, tool output, reasoning, path, or attachment. */
export type AgentReviewInput = {
  taskId: string
  sessionId: string
  turnId: string
  source: AgentTurnSource
  completedAt: number
  /** The turn's text and context in order, at most `MAX_REVIEW_USER_TEXT_BYTES` in all. */
  userText: AgentReviewText[]
  /** True when the aggregate bound cut or dropped a part. */
  userTextTruncated: boolean
  /** The turn's last top-level assistant message, at most `MAX_REVIEW_FINAL_TEXT_BYTES`. Empty when it wrote none. */
  finalText: string
  finalTextTruncated: boolean
}

/** `not-found` covers a missing turn and one outside the named task or session, so a reader learns
 *  nothing about turns it may not see. */
export type AgentReviewInputResult =
  | { available: true; input: AgentReviewInput }
  | { available: false; reason: 'not-found' | 'not-completed' }

/** Read one completed turn of one task for review (docs/managed-agents/session-events.md § Review input). */
export type AgentReviewInputCapability = {
  read(ref: { taskId: string; sessionId: string; turnId: string }): Promise<AgentReviewInputResult>
}

export const MAX_REVIEW_USER_TEXT_BYTES = 16 * 1024
export const MAX_REVIEW_FINAL_TEXT_BYTES = 32 * 1024

export const AGENTS_TURNS = capabilityId<AgentTurnsCapability>('agents.turns')
export const AGENTS_REQUESTS = capabilityId<AgentRequestsCapability>('agents.requests')
export const AGENTS_SESSIONS = capabilityId<AgentSessionsCapability>('agents.sessions')
export const AGENTS_REVIEW_INPUT = capabilityId<AgentReviewInputCapability>('agents.reviewInput.v1')
