import type { AgentContextSnapshot } from '@acorn/protocol/agentContext.ts'
import type { InlineDiffOrigin } from './inlineDiff.ts'

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

type AgentStatusAuthority = 'protocol' | 'lifecycle_hook' | 'process' | 'terminal_screen'
export type AgentController = 'acorn' | 'terminal' | 'external'
export type AgentSessionKind = 'interactive' | 'workflow' | 'delegated' | 'imported'
export type AgentAttendance = 'attended' | 'supervised' | 'autonomous'
// `delegation` is a turn an owner queued on its delegated child; `delegation_report` is the child's
// settled result queued back on that owner (docs/managed-agents/delegation.md § Managed delegation).
// `plugin` is a note a plugin queued through `agents:session-messenger`; its `effectivePolicy.sentBy`
// names the plugin (docs/managed-agents/session-messages.md).
export type AgentTurnSource =
  | 'interactive'
  | 'workflow'
  | 'delegation'
  | 'delegation_report'
  | 'automation'
  | 'import'
  | 'plugin'
  | 'goal'
export type AgentGoalStatus = 'active' | 'satisfied' | 'blocked' | 'paused' | 'exhausted' | 'cleared'
export type AgentGoalBlocker =
  | 'none'
  | 'missing_evidence'
  | 'needs_user_input'
  | 'run_failed'
  | 'external_wait'
  | 'goal_not_met_yet'
export type AgentGoalVerdict = {
  turnId: string
  satisfied: boolean
  blocker: AgentGoalBlocker
  reason: string
  evidence_summary: string
  relied_on_assumption: boolean
}
type AgentGoal = {
  objective: string
  status: AgentGoalStatus
  continuations: number
  noProgress: number
  verdict: AgentGoalVerdict | null
}
/** `steering` and `steered` belong to a queued turn a person handed to the running turn instead of
 *  waiting for it to end (docs/managed-agents/steering.md § What a steer does). A `steered` row
 *  is part of the turn it joined, so a session's turn list leaves it out. */
export type AgentTurnStatus =
  | 'queued'
  | 'dispatching'
  | 'active'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'interrupted'
  | 'steering'
  | 'steered'
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
  | 'generated_artifacts'
  /** acorn's bridge runs `agents:before-tool` on every tool call (docs/managed-agents/loop-hooks.md). */
  | 'loop_before_tool'
  /** acorn's bridge runs `agents:after-tool` on every finished tool call. */
  | 'loop_after_tool'
  /** The harness takes a message into the turn it's running (`AgentDriverSession.steer`). */
  | 'steering'

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
  /** Present when the harness can run more than one login: the extra accounts this Node holds, beside
   *  the default login `authenticated` describes (docs/managed-agents/accounts.md). */
  accounts?: AgentAccountDescriptor[]
  /** The account a new session starts on when it names none. Absent is the CLI's own login. */
  defaultAccount?: string
  /** Whether surfaces name an account or draw its icon. One choice for every harness, present with
   *  `accounts`. */
  accountDisplay?: 'name' | 'icon'
}

export type AgentAccountDescriptor = {
  /** The folder's name, which never changes. Sessions and routes name the account by it. */
  name: string
  /** What the person calls it, shown in place of `name`. */
  label?: string
  /** The icon the person chose for it, drawn in place of the name when `accountDisplay` is `icon`. */
  icon?: string
  authenticated: boolean | null
  /** The shell line that signs this account in, for the person to run on the Node. Null when the CLI
   *  isn't installed. */
  loginCommand: string | null
}

// The context source of the notes a delegated child starts with. The transcript draws this part in full.
export const DELEGATED_NOTES_SOURCE = 'notes.delegated'

export type AgentInputPart =
  | { type: 'text'; text: string }
  | { type: 'attachment'; attachmentId: string }
  | { type: 'file'; path: string; lineStart?: number; lineEnd?: number }
  | AgentContextSnapshot
  | { type: 'image'; attachmentId: string; alt?: string }

export type AgentUsage = {
  // Token counters follow the provider's declared accounting mode; Codex reports cumulative totals.
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  cacheWriteInputTokens?: number
  // With contextSize, this is the latest model context, not lifetime/session tokens.
  contextUsed?: number
  contextSize?: number
  cost?: { amount: number; currency: string }
}

export type AgentPermissionOption = {
  id: string
  label: string
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' | 'other'
}

/** How long an app-access grant lasts. `session` is the provider's own session, which for Codex is
 *  the thread a managed session drives; `always` is saved by the provider for later sessions. */
export type AgentApprovalScope = 'session' | 'always'

/**
 * An app-access approval a driver recognised in its provider's request metadata, reduced to what a
 * person needs to decide: which app, identified how, for how long, and any warning the provider
 * attached. The driver builds the options and the provider response; the card only reads this.
 * `scopes` is what the provider advertised, so a persistent choice exists only when `always` does.
 * The provider owns any grant it saves (docs/managed-agents/app-access.md § App-access approval).
 */
export type AgentAppApproval = {
  connector: string
  app: { name: string; id: string }
  scopes: AgentApprovalScope[]
  warning?: string
}

/** Who refused a permission request at `agents:before-permission`, and why. `by` is the plugin id the
 *  host stamped on the verdict, never a value the handler chose. `reason` is capped display text. */
export type AgentRequestBlocked = { by: string; reason: string }

export type AgentQuestion = {
  id: string
  header?: string
  prompt: string
  options?: Array<{ id: string; label: string; description?: string }>
  multiple?: boolean
  secret?: boolean
}

/**
 * What an agent did on the web, said the same way whichever harness did it.
 *
 * A search, a page opened, a pattern looked for on a page, a page fetched with a question about it.
 * The names are Acorn's: Codex spells the first two `search` and `openPage`, Claude Code spells the
 * last one `WebFetch`, and neither spelling reaches a card. A driver that cannot recognise its
 * provider's web call leaves this off and the call renders as any other tool
 * (docs/managed-agents/activity.md § Web activity).
 *
 * Every field is optional for the same reason `AgentToolCall.status` is: a provider reports the
 * request and the results on different updates, and absent has to mean unchanged rather than empty.
 */
export type AgentWebAction =
  | { type: 'search'; queries: string[]; allowedDomains?: string[]; blockedDomains?: string[] }
  | { type: 'open_page'; url?: string }
  | { type: 'find_in_page'; url?: string; pattern?: string }
  | { type: 'fetch_page'; url?: string; prompt?: string }
  | { type: 'other' }

/** One source a provider reported. `url` is what makes it a result; the rest is what it chose to say
 *  about it, and a card that has no `domain` shows the URL's own host rather than storing a derived
 *  one. Nothing here is fetched, ranked or checked — the transcript records the answer the provider
 *  gave, it does not search again. */
export type AgentWebResult = {
  url: string
  title?: string
  domain?: string
  snippet?: string
}

/** The HTTP status a fetched page answered with. Beside the action rather than inside it, because it
 *  arrives on a later update that carries no request, and the fold replaces an action whole. A
 *  provider can report a 404 as a finished call, so this is what tells a reader the page was not
 *  there. */
export type AgentWebStatus = { code: number; text?: string }

export type AgentWebActivity = {
  action?: AgentWebAction
  results?: AgentWebResult[]
  status?: AgentWebStatus
}

export type AgentToolCall = {
  id: string
  parentId?: string
  /** Stable MCP tool name, separate from the provider’s display title. */
  name?: string
  title: string
  kind?: string
  /** Absent means "unchanged": a provider update that only carries output must not drag a finished
   *  call back to running. The transcript projection folds a call's updates and keeps the last
   *  status that was actually reported. */
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'unknown'
  input?: string
  output?: string
  outputAppend?: boolean
  paths?: string[]
  /** The subagent that ran this call, when a harness attributes it (see AgentSubagent). */
  subagentId?: string
  /** A command that keeps running after its turn: Claude Code's `run_in_background` Bash call, or a
   *  Codex command still going when its turn completed. Sticky once set. Such a call stays `running`
   *  until the harness reports its exit, and its output keeps arriving on this card
   *  (docs/managed-agents/background-commands.md). */
  background?: boolean
  /** The command's exit code, when the harness reported one. */
  exitCode?: number
  /** Web activity, when the driver recognised this call as some. It sits beside `input` and `output`
   *  rather than replacing them: a renderer that has never heard of it still has the request and the
   *  provider's own text to draw. */
  web?: AgentWebActivity
}

export type AgentSubagentStatus = 'pending' | 'running' | 'idle' | 'completed' | 'failed'

/**
 * One subagent a session spawned, as a projection rather than a session row of its own: a subagent is
 * not something you can address, resume, or send a turn to, so making it a session would be a lie in
 * every table that reads one. docs/managed-agents/subagents.md states the model.
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
  /** Detached from the parent's turn: the spawning call returned the moment the child launched, so the
   *  child runs on while the parent's turn is over. Claude Code's `run_in_background` Agent call. It
   *  changes how completion is read, because that spawning call's own `completed` is a launch receipt,
   *  not the child's finish. See docs/managed-agents/subagents.md. */
  background?: boolean
  usage?: AgentUsage
  toolUseCount?: number
  durationMs?: number
  startedAt: number
  updatedAt: number
}

/** A subagent update. Absent means unchanged, the same convention AgentToolCall.status follows, so a
 *  harness that only learns the model at completion does not wipe the title it reported at spawn. */
export type AgentSubagentUpdate = Partial<Omit<AgentSubagent, 'id' | 'startedAt' | 'updatedAt'>> & { id: string }

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
  | {
      type: 'session_metadata'
      providerSessionRef?: string
      configOptions?: AgentConfigOption[]
      commands?: AgentCommandDescriptor[]
      skills?: AgentSkillDescriptor[]
    }
  /** `subagentId` means somebody other than the reader wrote this turn: it is the brief a subagent was
   *  handed, so it belongs in that subagent's stream rather than in the session's. */
  | {
      type: 'user_message'
      text: string
      subagentId?: string
      automatic?: boolean
      /** The queued turn this message came from, when a person steered it into the running turn. */
      steeredTurnId?: string
    }
  | { type: 'assistant_message'; text: string; messageId?: string; append?: boolean; subagentId?: string }
  | { type: 'reasoning'; text: string; messageId?: string; append?: boolean; subagentId?: string }
  | { type: 'tool'; tool: AgentToolCall }
  | { type: 'subagent'; subagent: AgentSubagentUpdate }
  | { type: 'plan'; entries: AgentPlanEntry[] }
  /** Codex's completed plan item, separate from turn/plan/updated progress steps. */
  | { type: 'plan_proposal'; itemId: string; providerTurnId: string; text: string }
  | { type: 'usage'; usage: AgentUsage }
  /** `blocked` marks a request refused by unattended policy or a permission policy plugin. The row is written
   *  resolved, never pending, and an older client draws it as an ordinary resolved request. */
  | {
      type: 'request'
      requestId: string
      kind: AgentRequestKind
      title: string
      detail?: string
      options?: AgentPermissionOption[]
      questions?: AgentQuestion[]
      approval?: AgentAppApproval
      blocked?: AgentRequestBlocked
    }
  | { type: 'request_resolved'; requestId: string; resolution: unknown }
  | {
      type: 'artifact'
      artifactId: string
      kind: AgentArtifactKind
      title: string
      mediaType?: string
      byteSize?: number
    }
  /** `patch` is the unified hunks for `path`, from the first `@@` on, with no file header. A change
   *  with no path is Codex's whole-turn diff, which is a multi-file git patch instead.
   *
   *  `changeId` names the edit this belongs to: the tool call, the Codex item, or the turn. Agents
   *  report one edit more than once as it firms up, and the thread keeps only the latest change for
   *  each id and path. `snippet` means the hunks came from an excerpt rather than the file, so their
   *  line numbers count from the top of the excerpt. `patchArtifactId` is set when the patch was too
   *  large to keep inline and went to that artifact instead. */
  | {
      type: 'file_change'
      path?: string
      patch?: string
      summary?: string
      subagentId?: string
      changeId?: string
      snippet?: boolean
      patchArtifactId?: string
    }
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
  origin?: InlineDiffOrigin | null
  driverKind: string
  driverVersion: string
  providerSessionRef: string | null
  controller: AgentController
  runtimeState: AgentRuntimeState
  attention: AgentAttentionReason
  statusAuthority: AgentStatusAuthority
  title: string
  model: string | null
  goal?: AgentGoal | null
  config: Record<string, unknown>
  parentSessionId: string | null
  parentTurnId: string | null
  /** Projected from the session's own `subagent` events by `AgentStore`, so every surface that reads
   *  a session row sees the live roster without loading its transcript. */
  subagents: AgentSubagent[]
  /** How many follow-up turns are queued and waiting to dispatch. Counted onto the list read model so a
   *  row can mark a waiting prompt without loading the transcript; a queued turn leaves `runtimeState`
   *  at `ready` or `working`, so it has no other sign on the row. Snapshot reads leave it 0, since the
   *  open pane derives its queue from the turns it already holds. */
  queuedTurns: number
  lastEventSeq: number
  lastReadSeq: number
  /** When the session last recorded an event, or null before its first. Absent from a node older than
   *  this field, so a reader falls back to `updatedAt`. */
  lastEventAt?: number | null
  archivedAt: number | null
  createdAt: number
  updatedAt: number
  /** Set on a row from a session list or search, which leaves out what only an open session reads
   *  (`sessionListRow`). The session's own read and its socket frames carry the full row. */
  listRow?: true
}

export type AgentTurn = {
  id: string
  sessionId: string
  ordinal: number
  source: AgentTurnSource
  status: AgentTurnStatus
  input: AgentInputPart[]
  /** The prompt used when Acorn resumes this same logical turn after a provider usage reset. The
   *  original input stays intact for exports, attachments, and workflow identity. */
  continuationInput?: AgentInputPart[] | null
  /** Earliest time the durable dispatcher may send this queued turn. */
  notBefore?: number | null
  effectivePolicy: Record<string, unknown> & { attendance?: AgentAttendance }
  providerTurnRef: string | null
  stopReason: string | null
  usage: AgentUsage | null
  error: { code: string; message: string } | null
  attempt: number
  createdAt: number
  startedAt: number | null
  completedAt: number | null
  /** For a `steered` turn, the running turn it joined. */
  steeredIntoTurnId?: string | null
}

export type AgentEventRecord = {
  id: string
  sessionId: string
  turnId: string | null
  seq: number
  schemaVersion: number
  event: AgentNormalizedEvent
  /** What the transcript search index holds for this row. Node-side only: the HTTP pages and the
   *  socket leave it out, since no client reads it and on a tool row it repeats the output. */
  searchText?: string | null
  createdAt: number
  /** Present on a record the node folded later rows into (`foldUsageEvents`, `foldToolEvents`):
   *  the seq of the last row it absorbed. A reader pages on from here, and treats a row at or below it
   *  for the same card as already applied. */
  foldedThroughSeq?: number
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

/** A request still waiting on a person, with the task its session belongs to, from the Node-wide read of
 *  open requests. A session's `attention` can't stand in for this: a subagent's event moves it to
 *  `unread`, and settling one of two requests moves it to `none`, while a request is still open. */
export type AgentOpenRequest = AgentRequest & { taskId: string }

export type AgentOpenRequestList = { requests: AgentOpenRequest[] }

export type AgentSessionSnapshot = {
  session: AgentSession
  /** Every turn but a steered one, in queue order. */
  turns: AgentTurn[]
  /** Queued turns a person steered into a running turn. Apart from `turns` because each is part of the
   *  turn it joined. The transcript reads one for its message's attachments and context. Absent from a
   *  Node older than steering. */
  steeredTurns?: AgentTurn[]
  events: AgentEventRecord[]
  requests: AgentRequest[]
  /** Authoritative wait outcome; ordinary snapshots and older Nodes omit this field.
   *  Mixed-version path until 2026-12-31. */
  wait?: AgentWaitFacts & { eventsThroughSeq: number; eventsComplete: boolean }
}

export type AgentWaitCondition = 'ready' | 'attention' | 'turn_completed' | 'stopped'

export type AgentWaitFacts = {
  until: AgentWaitCondition
  afterSeq: number
  matched: boolean
  terminal: { seq: number; turnId: string | null; type: 'turn_completed' | 'error' } | null
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
  owner: { kind: 'managed'; parentSessionId: string } | { kind: 'terminal'; label: string; profileId: string | null }
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

/** One tool call folded across the whole session, with the turn it ran in and the session's task. */
export type AgentToolCallRead = {
  tool: AgentToolCall
  turnId: string | null
  taskId: string
}

export type AgentDeleteResult = {
  local: 'deleted'
  provider: 'deleted' | 'unsupported' | 'failed'
  detail?: string
}

/** What Settings > Storage and memory shows for this plugin (docs/managed-agents/operations.md § Operations and
 *  failure). `idle` counts the processes Stop idle agents now would stop. `memoryBytes` is the resident
 *  memory of every provider process and its descendants, and null where the node cannot list processes.
 *  The two folder sizes are measured at most every 30 seconds. */
export type AgentFootprint = {
  live: number
  idle: number
  memoryBytes: number | null
  attachmentsBytes: number
  artifactsBytes: number
}

// `agent:turn` and `agent:request` are the node telling a client what a projected event changed.
// Without them a client would refetch the whole snapshot, a JSON body parsed per event row, to learn
// that one turn closed or one permission request was answered
// (docs/managed-agents/transcript-store.md § The transcript store).
export type AgentWsFrame =
  | { channel: 'agent:event'; event: AgentEventRecord }
  | { channel: 'agent:session'; session: AgentSession }
  | { channel: 'agent:turn'; turn: AgentTurn }
  | { channel: 'agent:request'; request: AgentRequest }
  | { channel: 'agent:deleted'; sessionId: string }

/** The words in a web call, so a reader can find a run by what it searched for or by a page it read.
 *  Beside the call's title and text rather than instead of them: the structured payload is the only
 *  copy of a query Codex reports, and the provider's own output is the only copy of the answer. */
const webSearchText = (web: AgentWebActivity | undefined): string[] => {
  if (!web) return []
  const action = web.action
  return [
    ...(action?.type === 'search'
      ? [...action.queries, ...(action.allowedDomains ?? []), ...(action.blockedDomains ?? [])]
      : []),
    ...(action && 'url' in action && action.url ? [action.url] : []),
    ...(action?.type === 'find_in_page' && action.pattern ? [action.pattern] : []),
    ...(action?.type === 'fetch_page' && action.prompt ? [action.prompt] : []),
    ...(web.results ?? []).flatMap((result) => [result.title, result.domain, result.url, result.snippet]),
  ].filter((value): value is string => Boolean(value))
}

export const agentEventSearchText = (event: AgentNormalizedEvent): string | null => {
  switch (event.type) {
    case 'user_message':
    case 'assistant_message':
    case 'reasoning':
    case 'plan_proposal':
      return event.text
    case 'tool':
      return [
        event.tool.title,
        event.tool.input,
        event.tool.output,
        ...(event.tool.paths ?? []),
        ...webSearchText(event.tool.web),
      ]
        .filter(Boolean)
        .join(' ')
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
