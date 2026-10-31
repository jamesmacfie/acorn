// The Agents plugin's contracts a plugin outside this repository calls or answers: hook payloads,
// extension point entries, and capabilities. Written out rather than aliased to `HostOwned`, as
// attachments.ts is, because their owner is `plugins/agents/src/contract/`, which a loaded plugin
// cannot import. tools/arch/agentContract.test.ts holds each one to its source.

// ── Hook payloads ─────────────────────────────────────────────────────────────────────────────────

/** What the harness asked to do. Every field is present, and empty when the harness sent nothing
 *  (docs/managed-agents/permission-policy.md § The payload). */
export type AgentPermissionSubject = {
  toolCallId: string
  kind: 'command' | 'edit' | 'read' | 'fetch' | 'permissions' | 'other'
  command: string
  paths: string[]
}

/** The `agents:before-permission` payload (docs/managed-agents/permission-policy.md). */
export type AgentBeforePermissionPayload = AgentPermissionSubject & {
  sessionId: string
  taskId: string
  /** The same id `agents.requests` reports. */
  requestId: string
  providerId: string
  unattended: boolean
  title: string
  /** The task's worktree root, `''` when it couldn't be read. */
  root: string
}

/** The `agents:before-tool` payload (docs/managed-agents/loop-hooks.md § The points). */
export type AgentBeforeToolPayload = AgentPermissionSubject & {
  sessionId: string
  taskId: string
  providerId: string
  unattended: boolean
  root: string
  toolName: string
  title: string
}

/** The `agents:after-tool` payload. A transform may set `note`; the host ignores any other change. */
export type AgentAfterToolPayload = AgentBeforeToolPayload & {
  succeeded: boolean
  note: string
}

// ── Extension point entries ───────────────────────────────────────────────────────────────────────

/** One note for an agent session (docs/managed-agents/session-messages.md). */
export type SessionMessage = {
  taskId: string
  sessionId: string
  /** At most 8 KiB of UTF-8, delivered to the agent as untrusted context. */
  text: string
  subject: string
  idempotencyKey: string
  /** Required on a workflow or delegated session: the turn the note is about. */
  originTurnId?: string
}

export type SessionMessageResult =
  | { ok: true; turnId: string }
  | {
      ok: false
      reason: 'unknown-session' | 'archived' | 'not-controlled' | 'operation-closed' | 'cap' | 'vetoed'
    }

export type SessionMessenger = {
  queue(message: SessionMessage): Promise<SessionMessageResult>
}

/** An `agents:session-messenger` entry. */
export type SessionMessengerContribution = {
  connect(sender: SessionMessenger): void | Promise<void>
}

/** One finished unattended turn, offered for review before its owner reports
 *  (docs/managed-agents/unattended-follow-ups.md § Review a finished turn). */
export type TurnFollowUpWindow = {
  taskId: string
  sessionId: string
  turnId: string
  owner: 'workflow' | 'delegation'
  /** Epoch milliseconds. */
  deadline: number
  signal: AbortSignal
}

/** An `agents:turn-follow-up` entry. */
export type TurnFollowUpContribution = {
  review(window: TurnFollowUpWindow): Promise<void>
}

// ── Capabilities ──────────────────────────────────────────────────────────────────────────────────

export type AgentTurnSource =
  | 'interactive'
  | 'workflow'
  | 'delegation'
  | 'delegation_report'
  | 'automation'
  | 'import'
  | 'plugin'
  | 'goal'

/** `agents.sessionControl` (docs/managed-agents/session-control.md § Calls). */
export type AgentSessionControl = {
  cancel(taskId: string, sessionId: string): Promise<void>
  setConfig(taskId: string, sessionId: string, optionId: string, value: string): Promise<void>
}

/** One event of a turn, as `onEvent` receives it. */
export type AgentStreamEvent = Record<string, unknown> & { type?: string }

/** The tools a turn may call: names it may use, and the highest risk among them. */
export type AgentToolCeiling = { allow?: string[]; maxRisk?: 'read' | 'write' | 'execute' }

export type AgentExecuteUsage = {
  costUsd: number | null
  usage:
    | { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; cacheWriteInputTokens?: number }
    | undefined
}

export type AgentGoalVerdict = {
  turnId: string
  satisfied: boolean
  blocker: 'none' | 'missing_evidence' | 'needs_user_input' | 'run_failed' | 'external_wait' | 'goal_not_met_yet'
  reason: string
  evidence_summary: string
  relied_on_assumption: boolean
}

export type AgentExecuteGoalSummary = {
  objective: string
  status: 'checking' | 'continuing' | 'satisfied' | 'blocked' | 'exhausted' | 'unavailable' | 'stopped'
  continuations: number
  repairs: number
  verdict: AgentGoalVerdict | null
  automaticTurns: { turnId: string; reason: 'goal' | 'repair' }[]
  reason?: string
}

/** One turn for `agents.sessionExecute` (docs/managed-agents/session-control.md § Running a turn from a
 *  plugin). The turn runs gated, with the harness's own permission checks on. */
export type AgentSessionExecuteRequest = {
  taskId: string
  /** An id from `agents.profiles`. Another profile answers null. */
  profileId: string | undefined
  /** Used only when a new session is created. */
  title: string
  prompt: string
  /** Material the prompt works on. Each item reaches the model as its own context block. */
  context?: { label: string; source: string; content: string }[]
  /** A JSON schema the answer must match. The result's `capture.structuredOutput` holds it. */
  schema?: object
  model?: string
  /** Harness option ids to the values this turn wants, such as `model` and `reasoning`. */
  configOptions?: Record<string, string>
  tools?: AgentToolCeiling
  timeoutMs?: number
  /** Continue a session this plugin started, from an earlier result's `agentSessionId`. */
  managedSessionId?: string
  /** Your own id for the turn. A retry with the same one reuses its session instead of starting another. */
  stepId?: string
  /** A completion condition the turn keeps working towards, checked after each turn. */
  goal?: string
  admitAutomatic?: (request: { kind: 'turn' | 'check'; usage: AgentExecuteUsage }) => Promise<string | null>
  onGoal?: (summary: AgentExecuteGoalSummary) => void
  onEvent?: (event: AgentStreamEvent) => void
  signal?: AbortSignal
}

export type AgentSessionExecuteResult = {
  status: 'ok' | 'error' | 'timeout' | 'malformed' | 'cancelled'
  exitCode: number | null
  capture: {
    result: string | null
    structuredOutput: unknown | null
    sessionId: string | null
    costUsd: number | null
    usage?: AgentExecuteUsage['usage']
    events: AgentStreamEvent[]
  }
  /** Why the turn ended without `ok`. */
  stderrTail: string
  agentSessionId?: string
  goal?: AgentExecuteGoalSummary
}

/** `agents.sessionExecute`. Null when the profile has no managed driver. */
export type AgentSessionExecute = (request: AgentSessionExecuteRequest) => Promise<AgentSessionExecuteResult | null>

/** `agents.profiles`: the profiles `agents.sessionExecute` can run on. */
export type AgentProfiles = {
  list(): Promise<{ id: string; label: string }[]>
  /** The same profiles as harness backends for `ModelBackendPicker`, with each one's models. Reading a
   *  live catalog can start the CLI, so call it when the picker opens. */
  backends(): Promise<
    {
      /** `harness:<profileId>`. */
      id: string
      kind: 'connection' | 'harness'
      label: string
      glyph?: string
      models: { id: string; label: string }[]
      catalogUnavailable?: boolean
      /** `''` leaves the CLI's own default. */
      defaultModelId: string
    }[]
  >
}

/** One row of a task's input-request inbox. */
export type AgentRequestState = {
  taskId: string
  sessionId: string
  requestId: string
  kind: 'permission' | 'question' | 'elicitation' | 'workflow_gate'
  status: 'pending' | 'resolving' | 'resolved' | 'expired'
  turnId: string | null
  title: string
  detail: string | null
  payload: Record<string, unknown>
  expiresAt: number | null
  createdAt: number
  resolvedAt: number | null
  /** Present when unattended policy or a permission policy plugin resolved the request before attention. */
  blocked?: { by: string; reason: string }
}

/** `agents.requests` (docs/managed-agents/session-events.md § Cross-plugin lifecycle). */
export type AgentRequestsCapability = {
  list(filter: { taskId: string; sessionId?: string }): Promise<AgentRequestState[]>
}

/** Who wrote one piece of a reviewed turn's input. Only `person` is the person's own words. */
export type AgentReviewProvenance =
  | { kind: 'person' }
  | { kind: 'turn'; source: AgentTurnSource }
  | { kind: 'context'; source: string; label: string }

export type AgentReviewText = { text: string; provenance: AgentReviewProvenance; truncated: boolean }

export type AgentReviewInput = {
  taskId: string
  sessionId: string
  turnId: string
  source: AgentTurnSource
  completedAt: number
  userText: AgentReviewText[]
  userTextTruncated: boolean
  finalText: string
  finalTextTruncated: boolean
}

export type AgentReviewInputResult =
  | { available: true; input: AgentReviewInput }
  | { available: false; reason: 'not-found' | 'not-completed' }

/** `agents.reviewInput.v1` (docs/managed-agents/session-events.md § Review input). */
export type AgentReviewInputCapability = {
  read(ref: { taskId: string; sessionId: string; turnId: string }): Promise<AgentReviewInputResult>
}

export type AgentActivityTool = {
  toolCallId: string
  turnId: string | null
  kind: string | null
  title: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'unknown'
  paths: string[]
  subagentId: string | null
}

export type AgentActivitySubagent = {
  subagentId: string
  turnId: string | null
  title: string
  role: string | null
  status: 'pending' | 'running' | 'idle' | 'completed' | 'failed'
  background: boolean
}

export type AgentActivityUsage = { contextUsed: number | null; contextSize: number | null }

/** One `plugin:agents:activity` frame. `events.on` hands it over untyped, so cast the frame to this. */
export type AgentActivityFrame = { channel: 'plugin:agents:activity'; taskId: string; sessionId: string } & (
  | { kind: 'tool'; tool: AgentActivityTool }
  | { kind: 'subagent'; subagent: AgentActivitySubagent }
  | { kind: 'usage'; usage: AgentActivityUsage }
)

export type AgentActivityState = {
  taskId: string
  sessionId: string
  tools: AgentActivityTool[]
  subagents: AgentActivitySubagent[]
  usage: AgentActivityUsage
}

/** `agents.activity.v1` (docs/managed-agents/session-events.md § Activity). */
export type AgentActivityCapability = {
  read(ref: { taskId: string; sessionId: string }): Promise<AgentActivityState | null>
}
