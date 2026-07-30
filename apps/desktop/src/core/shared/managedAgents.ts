export const AGENT_EVENT_SCHEMA_VERSION = 1

export type AgentRuntimeState =
  | 'creating'
  | 'connecting'
  | 'replaying'
  | 'ready'
  | 'working'
  | 'waiting'
  | 'cancelling'
  | 'reconnecting'
  | 'stopped'
  | 'failed'
  | 'archived'

export type AgentAttentionReason =
  | 'permission'
  | 'question'
  | 'workflow_gate'
  | 'completed'
  | 'error'
  | 'unread'
  | 'none'

export type AgentStatusAuthority = 'protocol' | 'lifecycle_hook' | 'process' | 'terminal_screen'
export type AgentController = 'acorn' | 'terminal' | 'external'
export type AgentSessionKind = 'interactive' | 'workflow' | 'imported'
export type AgentTurnSource = 'interactive' | 'workflow' | 'automation' | 'import'
export type AgentTurnStatus = 'queued' | 'dispatching' | 'active' | 'completed' | 'cancelled' | 'failed' | 'interrupted'
export type AgentRequestKind = 'permission' | 'question' | 'elicitation' | 'workflow_gate'
export type AgentRequestStatus = 'pending' | 'resolving' | 'resolved' | 'expired'
export type AgentArtifactKind =
  | 'file'
  | 'patch'
  | 'command_output'
  | 'screenshot'
  | 'plan'
  | 'export'
  | 'http_exchange'
  | 'database_result'
  | 'other'

export type AgentAttachment = {
  id: string
  taskId: string
  filename: string
  mediaType: string
  byteSize: number
  createdAt: number
}

export type AgentCapability =
  | 'streaming_messages'
  | 'reasoning'
  | 'tool_calls'
  | 'plans'
  | 'permissions'
  | 'questions'
  | 'elicitations'
  | 'models'
  | 'reasoning_levels'
  | 'modes'
  | 'permission_policies'
  | 'commands'
  | 'skills'
  | 'usage'
  | 'resume'
  | 'fork'
  | 'compact'
  | 'archive'
  | 'delete'
  | 'terminals'
  | 'file_changes'
  | 'subagents'
  | 'attachments'

export type AgentConfigOption = {
  id: string
  label: string
  category: 'model' | 'reasoning' | 'mode' | 'permission' | 'other'
  currentValue: string | null
  values: Array<{ value: string; label: string; description?: string }>
}

export type AgentCommandDescriptor = {
  name: string
  description?: string
  inputHint?: string
}

export type AgentSkillDescriptor = {
  name: string
  description?: string
  path?: string
}

export type AgentProviderDescriptor = {
  id: string
  profileId: string
  label: string
  driverKind: 'acp' | 'codex-app-server' | 'terminal'
  driverVersion: string
  installed: boolean
  authenticated: boolean | null
  executable?: string
  executableVersion?: string
  statusAuthority: AgentStatusAuthority
  capabilities: AgentCapability[]
  configOptions: AgentConfigOption[]
  commands: AgentCommandDescriptor[]
  skills: AgentSkillDescriptor[]
  diagnostics: string[]
}

export type AgentInputPart =
  | { type: 'text'; text: string }
  | { type: 'attachment'; attachmentId: string }
  | { type: 'file'; path: string; lineStart?: number; lineEnd?: number }
  | {
      type: 'context'
      contextId: string
      label: string
      content: string
      source: string
      resourceId?: string
      provenance?: string
      deepLink?: { pane: string; intent?: Record<string, unknown> }
      byteSize?: number
      estimatedTokens?: number
      freshness?: 'live' | 'cached' | 'stale' | 'unknown'
      sensitivity?: 'public' | 'workspace' | 'private' | 'secret'
      capturedAt: number
    }
  | { type: 'image'; attachmentId: string; alt?: string }

export type AgentUsage = {
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  contextUsed?: number
  contextSize?: number
  cost?: { amount: number; currency: string }
}

export type AgentPermissionOption = {
  id: string
  label: string
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' | 'other'
}

export type AgentQuestion = {
  id: string
  header?: string
  prompt: string
  options?: Array<{ id: string; label: string; description?: string }>
  multiple?: boolean
  secret?: boolean
}

export type AgentToolCall = {
  id: string
  parentId?: string
  title: string
  kind?: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  input?: string
  output?: string
  outputAppend?: boolean
  paths?: string[]
}

export type AgentArtifact = {
  id: string
  sessionId: string
  turnId: string | null
  kind: AgentArtifactKind
  title: string
  mediaType: string | null
  byteSize: number | null
  metadata: Record<string, unknown>
  createdAt: number
}

export type AgentPlanEntry = {
  id: string
  text: string
  status: 'pending' | 'in_progress' | 'completed'
}

export type AgentNormalizedEvent =
  | { type: 'session_state'; state: AgentRuntimeState; detail?: string }
  | { type: 'session_metadata'; providerSessionRef?: string; configOptions?: AgentConfigOption[]; commands?: AgentCommandDescriptor[]; skills?: AgentSkillDescriptor[] }
  | { type: 'user_message'; text: string }
  | { type: 'assistant_message'; text: string; messageId?: string; append?: boolean }
  | { type: 'reasoning'; text: string; messageId?: string; append?: boolean }
  | { type: 'tool'; tool: AgentToolCall }
  | { type: 'plan'; entries: AgentPlanEntry[] }
  | { type: 'usage'; usage: AgentUsage }
  | { type: 'request'; requestId: string; kind: AgentRequestKind; title: string; detail?: string; options?: AgentPermissionOption[]; questions?: AgentQuestion[] }
  | { type: 'request_resolved'; requestId: string; resolution: unknown }
  | { type: 'artifact'; artifactId: string; kind: AgentArtifactKind; title: string; mediaType?: string; byteSize?: number }
  | { type: 'file_change'; path?: string; patch?: string; summary?: string }
  | { type: 'terminal'; terminalSessionId: string; title: string }
  | { type: 'turn_completed'; stopReason?: string }
  | { type: 'error'; code: string; message: string; retryable: boolean }
  | { type: 'diagnostic'; level: 'info' | 'warning'; message: string }

export type AgentSession = {
  id: string
  taskId: string
  providerId: string
  profileId: string
  kind: AgentSessionKind
  driverKind: string
  driverVersion: string
  providerSessionRef: string | null
  controller: AgentController
  runtimeState: AgentRuntimeState
  attention: AgentAttentionReason
  statusAuthority: AgentStatusAuthority
  title: string
  model: string | null
  config: Record<string, unknown>
  parentSessionId: string | null
  parentTurnId: string | null
  lastEventSeq: number
  lastReadSeq: number
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}

export type AgentTurn = {
  id: string
  sessionId: string
  ordinal: number
  source: AgentTurnSource
  status: AgentTurnStatus
  input: AgentInputPart[]
  effectivePolicy: Record<string, unknown>
  providerTurnRef: string | null
  stopReason: string | null
  usage: AgentUsage | null
  error: { code: string; message: string } | null
  attempt: number
  createdAt: number
  startedAt: number | null
  completedAt: number | null
}

export type AgentEventRecord = {
  id: string
  sessionId: string
  turnId: string | null
  seq: number
  schemaVersion: number
  event: AgentNormalizedEvent
  searchText: string | null
  createdAt: number
}

export type AgentRequest = {
  id: string
  sessionId: string
  turnId: string | null
  providerRequestId: string
  kind: AgentRequestKind
  status: AgentRequestStatus
  title: string
  detail: string | null
  payload: Record<string, unknown>
  resolution: unknown
  expiresAt: number | null
  createdAt: number
  resolvedAt: number | null
}

export type AgentSessionSnapshot = {
  session: AgentSession
  turns: AgentTurn[]
  events: AgentEventRecord[]
  requests: AgentRequest[]
}

export type AgentSessionList = {
  sessions: AgentSession[]
  nextCursor: string | null
}

export type AgentEventPage = {
  events: AgentEventRecord[]
  nextCursor: number | null
}

export type AgentDeleteResult = {
  local: 'deleted'
  provider: 'deleted' | 'unsupported' | 'failed'
  detail?: string
}

export type AgentWsFrame =
  | { channel: 'agent:event'; event: AgentEventRecord }
  | { channel: 'agent:session'; session: AgentSession }
  | { channel: 'agent:deleted'; sessionId: string }

export const agentEventSearchText = (event: AgentNormalizedEvent): string | null => {
  switch (event.type) {
    case 'user_message':
    case 'assistant_message':
    case 'reasoning':
      return event.text
    case 'tool':
      return [event.tool.title, event.tool.input, event.tool.output, ...(event.tool.paths ?? [])].filter(Boolean).join(' ')
    case 'file_change':
      return [event.path, event.summary].filter(Boolean).join(' ')
    case 'artifact':
      return event.title
    case 'error':
    case 'diagnostic':
      return event.message
    default:
      return null
  }
}
