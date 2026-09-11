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

export type AgentSessionsChangedEvent = {
  taskId: string
  sessionId: string
  present: boolean
  archived: boolean
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

export type AgentSessionRosterEntry = AgentSessionsChangedEvent & {
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

export const AGENTS_TURNS = capabilityId<AgentTurnsCapability>('agents.turns')
export const AGENTS_REQUESTS = capabilityId<AgentRequestsCapability>('agents.requests')
export const AGENTS_SESSIONS = capabilityId<AgentSessionsCapability>('agents.sessions')
