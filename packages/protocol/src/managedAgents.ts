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
export type AgentSessionKind = 'interactive' | 'workflow' | 'delegated' | 'imported'
export type AgentTurnSource = 'interactive' | 'workflow' | 'delegation' | 'automation' | 'import'
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
  // A Lucide name or a `brand:` mark for the harness, drawn wherever a surface names it. Optional: the
  // Icon resolver renders an unmatched name as text, which is what a one-character glyph relies on.
  glyph?: string
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
  /** Absent means "unchanged": a provider update that only carries output must not drag a finished
   *  call back to running. The transcript projection folds a call's updates and keeps the last
   *  status that was actually reported. */
  status?: 'pending' | 'running' | 'completed' | 'failed'
  input?: string
  output?: string
  outputAppend?: boolean
  paths?: string[]
  /** The subagent that ran this call, when a harness attributes it (see AgentSubagent). */
  subagentId?: string
}

export type AgentSubagentStatus = 'pending' | 'running' | 'idle' | 'completed' | 'failed'

/**
 * One subagent a session spawned, as a projection rather than a session row of its own: a subagent is
 * not something you can address, resume, or send a turn to, so making it a session would be a lie in
 * every table that reads one. docs/managed-agents.md, section Subagents, states the model.
 *
 * `id` is whatever the harness makes stable from the moment the subagent starts, which differs by
 * harness: Claude's spawning tool call, Codex's child thread. `providerAgentRef` is the harness's own
 * handle, which on both is a resumable one but arrives at different times.
 */
export type AgentSubagent = {
  id: string
  turnId: string | null
  title: string
  status: AgentSubagentStatus
  /** What kind of subagent it is: Claude's `agentType`, Codex's agent path segment. */
  role?: string
  model?: string
  providerAgentRef?: string
  usage?: AgentUsage
  toolUseCount?: number
  durationMs?: number
  startedAt: number
  updatedAt: number
}

/** A subagent update. Absent means unchanged, the same convention AgentToolCall.status follows, so a
 *  harness that only learns the model at completion does not wipe the title it reported at spawn. */
export type AgentSubagentUpdate =
  Partial<Omit<AgentSubagent, 'id' | 'startedAt' | 'updatedAt'>> & { id: string }

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
  | { type: 'assistant_message'; text: string; messageId?: string; append?: boolean; subagentId?: string }
  | { type: 'reasoning'; text: string; messageId?: string; append?: boolean; subagentId?: string }
  | { type: 'tool'; tool: AgentToolCall }
  | { type: 'subagent'; subagent: AgentSubagentUpdate }
  | { type: 'plan'; entries: AgentPlanEntry[] }
  | { type: 'usage'; usage: AgentUsage }
  | { type: 'request'; requestId: string; kind: AgentRequestKind; title: string; detail?: string; options?: AgentPermissionOption[]; questions?: AgentQuestion[] }
  | { type: 'request_resolved'; requestId: string; resolution: unknown }
  | { type: 'artifact'; artifactId: string; kind: AgentArtifactKind; title: string; mediaType?: string; byteSize?: number }
  | { type: 'file_change'; path?: string; patch?: string; summary?: string; subagentId?: string }
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
  /** Projected from the session's own `subagent` events by the repository, so every surface that reads
   *  a session row sees the live roster without loading its transcript. */
  subagents: AgentSubagent[]
  /** How many follow-up turns are queued and waiting to dispatch. Counted onto the list read model so a
   *  row can mark a waiting prompt without loading the transcript; a queued turn leaves `runtimeState`
   *  at `ready` or `working`, so it has no other sign on the row. Snapshot reads leave it 0, since the
   *  open pane derives its queue from the turns it already holds. */
  queuedTurns: number
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

/** Display-only delegation lineage projected by the Agents plugin for sessions in a list page.
 *
 * The managed parent id is useful navigation within the same task. A terminal owner is deliberately
 * represented by a label and profile only: its authority id is neither needed nor exposed to the
 * renderer.
 */
export type AgentSessionDelegation = {
  sessionId: string
  depth: number
  isolation: 'shared' | 'worktree'
  owner:
    | { kind: 'managed'; parentSessionId: string }
    | { kind: 'terminal'; label: string; profileId: string | null }
}

export type AgentSessionList = {
  sessions: AgentSession[]
  delegations: AgentSessionDelegation[]
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

// `agent:turn` and `agent:request` are the node telling a client what a projected event changed.
// Without them a client had to refetch the whole snapshot — up to 2,000 event rows, a JSON body parsed
// per row — to learn that one turn had closed or one permission request had been answered
// (docs/managed-agents.md § The transcript store).
export type AgentWsFrame =
  | { channel: 'agent:event'; event: AgentEventRecord }
  | { channel: 'agent:session'; session: AgentSession }
  | { channel: 'agent:turn'; turn: AgentTurn }
  | { channel: 'agent:request'; request: AgentRequest }
  | { channel: 'agent:deleted'; sessionId: string }

export const agentEventSearchText = (event: AgentNormalizedEvent): string | null => {
  switch (event.type) {
    case 'user_message':
    case 'assistant_message':
    case 'reasoning':
      return event.text
    case 'tool':
      return [event.tool.title, event.tool.input, event.tool.output, ...(event.tool.paths ?? [])].filter(Boolean).join(' ')
    case 'subagent':
      return [event.subagent.title, event.subagent.role].filter(Boolean).join(' ') || null
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
