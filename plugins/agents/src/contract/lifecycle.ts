import type { AgentAttentionReason, AgentRuntimeState, AgentSessionKind } from '@acorn/protocol/managedAgents.ts'
import { capabilityId } from '@acorn/plugin-api/node'

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

export type AgentLifecycleFrame = {
  channel: 'plugin:agents:sessions-changed'
} & AgentSessionsChangedEvent

export type AgentLifecyclePublisher = (frame: AgentLifecycleFrame) => void

export type AgentSessionRosterEntry = {
  taskId: string
  sessionId: string
  present: true
  archived: boolean
  providerId: string
  profileId: string
  kind: AgentSessionKind
  title: string
  runtimeState: AgentRuntimeState
  attention: AgentAttentionReason
  createdAt: number
  updatedAt: number
}

/** Rebuild one task's active and archived managed-session roster after an invalidation event. */
export type AgentSessionsCapability = {
  list(taskId: string): Promise<AgentSessionRosterEntry[]>
}

export const AGENTS_SESSIONS = capabilityId<AgentSessionsCapability>('agents.sessions')
