import type {
  AgentAttentionReason,
  AgentRequestKind,
  AgentRequestStatus,
  AgentRuntimeState,
  AgentSessionKind,
  AgentTurnSource,
  AgentTurnStatus,
} from '@acorn/protocol/managedAgents.ts'
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

export type AgentReviewInputRef = Pick<AgentTurnChangedEvent, 'taskId' | 'sessionId' | 'turnId' | 'source' | 'attempt'> & {
  purpose: 'ordinary' | 'workflow' | 'review'
  completedSequence: number
  completedAt: number
}

export type AgentReviewInput = AgentReviewInputRef & {
  availability: 'available' | 'unavailable'
  assistantSummary: string | null
  userMessages: string[]
  unavailableReason: string | null
}

/** Bounded, task-authorized completion input. Consumers never receive the agent event ledger. */
export type AgentReviewInputCapability = {
  listCompleted(taskId: string): Promise<AgentReviewInputRef[]>
  read(input: { taskId: string; sessionId: string; turnId: string }): Promise<AgentReviewInput>
}

export const AGENTS_TURNS = capabilityId<AgentTurnsCapability>('agents.turns')
export const AGENTS_REQUESTS = capabilityId<AgentRequestsCapability>('agents.requests')
export const AGENTS_SESSIONS = capabilityId<AgentSessionsCapability>('agents.sessions')
export const AGENTS_REVIEW_INPUT = capabilityId<AgentReviewInputCapability>('agents.reviewInput.v1')
