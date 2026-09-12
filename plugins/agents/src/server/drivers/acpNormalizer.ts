import type {
  AvailableCommand,
  CreateElicitationRequest,
  CreateElicitationResponse,
  RequestPermissionRequest,
  SessionConfigOption,
  SessionUpdate,
} from '@agentclientprotocol/sdk'
import type {
  AgentCommandDescriptor,
  AgentConfigOption,
  AgentNormalizedEvent,
  AgentPermissionOption,
  AgentQuestion,
  AgentSubagentUpdate,
  AgentToolCall,
  AgentUsage,
} from '@acorn/protocol/managedAgents.ts'

const permissionKind = (kind: string): AgentPermissionOption['kind'] =>
  kind === 'allow_once' || kind === 'allow_always' || kind === 'reject_once' || kind === 'reject_always'
    ? kind
    : 'other'

export function normalizeAcpPermission(
  requestId: string,
  request: RequestPermissionRequest,
): AgentNormalizedEvent {
  return {
    type: 'request',
    requestId,
    kind: 'permission',
    title: request.toolCall.title ?? 'Allow tool?',
    detail: request.toolCall.kind ?? undefined,
    options: request.options.map((option) => ({
      id: option.optionId,
      label: option.name,
      kind: permissionKind(option.kind),
    })),
  }
}

// A form elicitation is the other way an ACP agent blocks on a person: not "may I", but "which one".
// Claude Code's AskUserQuestion arrives here, and so does an MCP server that asks a question of its
// own; both are off unless the client says it can draw a form (./acpDriver.ts, `clientCapabilities`).
//
// One schema property becomes one question, and nothing here knows a vendor's field names. The Claude
// adapter pairs every choice with a free-text box beside it, which lands as its own question titled
// "Other", the same shape any other agent's form would produce.
type FormProperty = {
  type?: string
  title?: string | null
  description?: string | null
  enum?: string[] | null
  oneOf?: EnumOption[] | null
  items?: { enum?: string[] | null; anyOf?: EnumOption[] | null } | null
}
type EnumOption = { const: string; title?: string | null; description?: string | null }

const formProperties = (request: CreateElicitationRequest): Array<[string, FormProperty]> => {
  // The request is a union whose open member swallows the schema into `unknown`, so it is read back
  // through the narrow shape this file uses rather than through the SDK's own.
  const schema = ('requestedSchema' in request ? request.requestedSchema : undefined) as
    { properties?: Record<string, unknown> } | undefined
  return Object.entries(schema?.properties ?? {}).map(([key, value]) => [key, value as FormProperty])
}

// The choices a property offers, or nothing when it is a free-text field. `id` is what goes back to the
// agent and `label` is what a person reads, which differ whenever the agent titles its options.
const formOptions = (property: FormProperty): AgentQuestion['options'] => {
  const titled = property.type === 'array' ? property.items?.anyOf : property.oneOf
  if (titled?.length) {
    return titled.map((option) => ({
      id: option.const,
      label: option.title || option.const,
      ...(option.description ? { description: option.description } : {}),
    }))
  }
  const bare = property.type === 'array' ? property.items?.enum : property.enum
  if (bare?.length) return bare.map((value) => ({ id: value, label: value }))
  if (property.type === 'boolean') return [{ id: 'true', label: 'Yes' }, { id: 'false', label: 'No' }]
  return undefined
}

export function normalizeAcpElicitation(
  requestId: string,
  request: CreateElicitationRequest,
): AgentNormalizedEvent {
  return {
    type: 'request',
    requestId,
    // 'question' rather than 'elicitation', because that word is on the card in front of a person.
    kind: 'question',
    title: request.message,
    questions: formProperties(request).map(([key, property]) => {
      const options = formOptions(property)
      const title = property.title ?? undefined
      const description = property.description ?? undefined
      return {
        id: key,
        // Both only when the property carries both. A form with one question puts that question in
        // `message` and leaves the field with a bare header, so using the header twice reads twice.
        ...(title && description ? { header: title } : {}),
        prompt: description ?? title ?? request.message,
        ...(options ? { options } : {}),
        ...(property.type === 'array' ? { multiple: true } : {}),
      }
    }),
    // A form marks nothing required, so leaving is always allowed. Skip tells the agent nobody
    // answered and lets the turn carry on; only a cancelled turn aborts the call behind it.
    options: [{ id: 'decline', label: 'Skip', kind: 'reject_once' }],
  }
}

// What a person picked, on its way back to the agent. The card answers with labels, so each one is
// matched to the option that offered it and the option's own value is what travels.
const formValue = (property: FormProperty, label: string): string =>
  formOptions(property)?.find((option) => option.label === label)?.id ?? label

export function acpElicitationResponse(
  request: CreateElicitationRequest,
  resolution: unknown,
): CreateElicitationResponse {
  const row = (typeof resolution === 'object' && resolution != null ? resolution : {}) as Record<string, unknown>
  // The Skip button, and a request drained by a cancelled turn.
  if (typeof row.optionId === 'string') return row.optionId === 'cancel' ? { action: 'cancel' } : { action: 'decline' }
  const answers = (typeof row.answers === 'object' && row.answers != null ? row.answers : {}) as Record<string, unknown>
  const content: Record<string, string | number | boolean | string[]> = {}
  for (const [key, property] of formProperties(request)) {
    const answer = answers[key]
    const picked = (Array.isArray(answer) ? answer.map(String) : [String(answer ?? '')])
      .filter((value) => value !== '')
      .map((label) => formValue(property, label))
    if (!picked.length) continue
    if (property.type === 'array') content[key] = picked
    else if (property.type === 'boolean') content[key] = picked[0] === 'true'
    else if (property.type === 'number' || property.type === 'integer') {
      const value = Number(picked[0])
      if (!Number.isNaN(value)) content[key] = value
    } else content[key] = picked[0]
  }
  // An unanswered property is simply absent, including one the schema marked `required`.
  // Claude's adapter marks none, and an agent that does gets the same "skipped" it gets from decline.
  return { action: 'accept', content }
}

const configCategory = (category: string | null | undefined): AgentConfigOption['category'] => {
  if (category === 'model') return 'model'
  if (category === 'mode') return 'mode'
  if (category === 'thought_level' || category === 'model_config') return 'reasoning'
  return 'other'
}

export function normalizeAcpConfig(options: readonly SessionConfigOption[] | null | undefined): AgentConfigOption[] {
  return (options ?? []).map((option) => {
    if (option.type === 'boolean') {
      return {
        id: option.id,
        label: option.name,
        category: configCategory(option.category),
        currentValue: String(option.currentValue),
        values: [
          { value: 'true', label: 'On' },
          { value: 'false', label: 'Off' },
        ],
      }
    }
    const values = option.options.flatMap((entry) => {
      if ('group' in entry) {
        return entry.options.map((value) => ({
          value: value.value,
          label: value.name,
          description: value.description ?? undefined,
        }))
      }
      return [{
        value: entry.value,
        label: entry.name,
        description: entry.description ?? undefined,
      }]
    })
    return {
      id: option.id,
      label: option.name,
      category: configCategory(option.category),
      currentValue: option.currentValue,
      values,
    }
  })
}

export const normalizeAcpCommands = (
  commands: readonly AvailableCommand[] | null | undefined,
): AgentCommandDescriptor[] =>
  (commands ?? []).map((command) => ({
    name: command.name,
    description: command.description || undefined,
    inputHint: command.input && 'hint' in command.input ? String(command.input.hint) : undefined,
  }))

// Command output arrives fenced as markdown, ```console around the whole of it, because the same
// adapter code path serves clients that render tool output as markdown. Acorn's tool output is plain
// text in a <pre>, where a fence shows up as literal backticks on the first and last line. Scanning
// rather than a regex, so a long line of output cannot start the engine backtracking. Output that both
// opens and closes with a fence of its own loses those two lines, which is worth the common case.
function unfenced(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('```') || !trimmed.endsWith('```')) return text
  const firstBreak = trimmed.indexOf('\n')
  return firstBreak < 0 ? text : trimmed.slice(firstBreak + 1, -3).trimEnd()
}

// ACP's `_meta` is an open extension bag, typed `{[key: string]: unknown}`, and `claudeCode` is Claude
// Code's namespace inside it. Read here in the shared normalizer rather than behind a harness quirk on
// purpose: another harness's namespace is simply absent, so the branches below cost nothing, and
// HarnessQuirks says a quirk joins that list when a SECOND harness needs one.
//
// What the adapter puts there, confirmed against a live capture on Claude Code 2.1.241 with adapter
// 0.54.1 (drivers/__fixtures__/claudeSubagentWire.json):
//   toolName          the CLI's own name for the tool, on every tool_call and most updates
//   parentToolUseId   the spawning `Agent` call, on everything a subagent did
//   toolResponse      the structured result; for a subagent it names the agent and reports its usage
type ClaudeToolMeta = {
  toolName?: string
  parentToolUseId?: string
  /** A progress ping rather than a call. See the early return in normalizeAcpUpdate. */
  heartbeat?: boolean
  subagent?: {
    agentId: string
    agentType?: string
    resolvedModel?: string
    status?: string
    totalTokens?: number
    totalToolUseCount?: number
    totalDurationMs?: number
  }
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value != null && !Array.isArray(value) ? value as Record<string, unknown> : null

const str = (value: unknown): string | undefined => typeof value === 'string' && value ? value : undefined
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

function claudeToolMeta(meta: unknown): ClaudeToolMeta {
  const claude = asRecord(asRecord(meta)?.claudeCode)
  if (!claude) return {}
  const response = asRecord(claude.toolResponse)
  // A tool response only describes a subagent when it names one. The adapter sends the completion
  // update with a toolResponse and NO toolName, so `agentId` is the only thing that identifies it.
  const agentId = str(response?.agentId)
  return {
    toolName: str(claude.toolName),
    parentToolUseId: str(claude.parentToolUseId),
    // The heartbeat is the one toolResponse that reports elapsed time and nothing else. A real result
    // that happens to carry a duration also names its agent, so the two cannot be confused.
    heartbeat: agentId == null && num(response?.elapsedTimeSeconds) != null,
    subagent: agentId
      ? {
        agentId,
        agentType: str(response?.agentType),
        resolvedModel: str(response?.resolvedModel),
        status: str(response?.status),
        totalTokens: num(response?.totalTokens),
        totalToolUseCount: num(response?.totalToolUseCount),
        totalDurationMs: num(response?.totalDurationMs),
      }
      : undefined,
  }
}

// The CLI's two names for delegating to a subagent. `Agent` is what Claude Code 2.1.241 sends, `Task`
// is the older name the adapter still maps, and both land on the same tool.
const SUBAGENT_TOOLS = new Set(['Agent', 'Task'])

/**
 * A call's own parameters, so a card has something to show before its output arrives. Without this the
 * only thing the ACP path ever filled in was output, which lands on the completion update, so a
 * running call had nothing to disclose and its card could not honour the reader's fold setting until
 * it had finished.
 *
 * Pretty-printed JSON rather than a per-tool reading of it: every tool names its parameters
 * differently, and a table of which field to pull for which tool name would need an entry for every
 * tool a harness adds. The bounds are the materializer's, which promotes anything past 64 KiB to an
 * artifact, so a call that carries a whole file in its parameters does not land in SQLite.
 */
const toolInput = (rawInput: unknown): string | undefined => {
  if (rawInput == null || typeof rawInput !== 'object' || Array.isArray(rawInput)) return undefined
  if (!Object.keys(rawInput).length) return undefined
  try {
    return JSON.stringify(rawInput, null, 2)
  } catch {
    // A cycle, which no wire value should have and none is worth a card for.
    return undefined
  }
}

// Absent stays absent. ACP sends a status only when it changes, so an update that carries nothing but
// command output would otherwise reset a finished call to running once the transcript folds the two.
function toolStatus(status: string | null | undefined): AgentToolCall['status'] {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'pending') return 'pending'
  if (status === 'in_progress') return 'running'
  return undefined
}

// `harness` is the label of the agent whose events these are. A parameter, not a constant, because
// this file is the shared half of the generic driver (./acpDriver.ts) and it writes the
// label into three user-visible strings.
export function normalizeAcpUpdate(update: SessionUpdate, harness: string): AgentNormalizedEvent[] {
  switch (update.sessionUpdate) {
    case 'user_message_chunk':
      return []
    // Attributed the same way as a tool call. Claude Code 2.1.241 never forwards a subagent's own
    // prose, so `parentToolUseId` is always absent here today. The adapter has the code path, and one
    // field costs nothing against the day the CLI starts using it.
    case 'agent_message_chunk':
      return update.content.type === 'text'
        ? [{
          type: 'assistant_message',
          text: update.content.text,
          messageId: update.messageId ?? undefined,
          append: true,
          subagentId: claudeToolMeta(update._meta).parentToolUseId,
        }]
        : []
    case 'agent_thought_chunk':
      return update.content.type === 'text'
        ? [{
          type: 'reasoning',
          text: update.content.text,
          messageId: update.messageId ?? undefined,
          append: true,
          subagentId: claudeToolMeta(update._meta).parentToolUseId,
        }]
        : []
    case 'tool_call':
    case 'tool_call_update': {
      const meta = claudeToolMeta(update._meta)
      // A heartbeat is Claude Code saying a call it already told us about is still going: the CLI pings
      // every 30 seconds for any tool still running, and the adapter forwards it as a tool_call_update
      // under an id it made up, `<the real id>-heartbeat-<n>`. Reading that as a call mints a fresh
      // card every 30 seconds, and when the tool is `Agent` it mints a fresh subagent row too, which
      // nothing can ever settle: that id never appears on the wire again, so the completion lands on
      // the real call and the row sits at "Working" for good. We already show the call as running, so
      // the ping has nothing to add.
      if (meta.heartbeat) return []
      const blocks = update.content ?? []
      // A command's stdout arrives as inline text blocks, because Acorn declines ACP's terminal
      // capability, so this is the only place it can be picked up. The card renders it behind a
      // disclosure toggle. `content` replaces rather than appends in ACP, hence no outputAppend.
      const text = blocks
        .flatMap((content) => content.type === 'content' && content.content.type === 'text'
          ? [unfenced(content.content.text)]
          : [])
        .join('\n')
      const status = toolStatus(update.status)
        ?? (update.sessionUpdate === 'tool_call' ? 'pending' : undefined)
      // A spawning call belongs to the subagent it starts, not to the parent. That is what makes the
      // transcript nest it inside the subagent's card, so the prompt and the final report read as the
      // subagent's own rather than as one more tool the parent ran.
      const spawn = (meta.toolName != null && SUBAGENT_TOOLS.has(meta.toolName)) || meta.subagent != null
      const subagentId = spawn ? update.toolCallId : meta.parentToolUseId
      const roster: AgentNormalizedEvent[] = spawn
        ? [{ type: 'subagent', subagent: subagentFromToolCall(update.toolCallId, update.title, status, meta) }]
        : []
      // A diff belongs to whoever made the edit, the same as the call it arrived on. Left unattributed
      // it rendered in the parent's stream while the Edit call that produced it sat inside the
      // subagent's, so a subagent's run showed the tool and not what it changed.
      const diffs = blocks.flatMap((content) =>
        content.type === 'diff'
          ? [{
            type: 'file_change' as const,
            path: content.path,
            summary: `${harness} updated a file.`,
            subagentId,
          }]
          : [])
      return [...roster, {
        type: 'tool',
        tool: {
          id: update.toolCallId,
          // Empty rather than a made-up name: a tool_call always names itself, an update need not,
          // and the fold keeps the name the call arrived with.
          title: update.title ?? '',
          kind: update.kind ?? undefined,
          status,
          input: toolInput(update.rawInput),
          output: text || undefined,
          subagentId,
        },
      }, ...diffs]
    }
    case 'plan':
      return [{
        type: 'plan',
        entries: update.entries.map((entry, index) => ({
          id: `plan-${index}`,
          text: entry.content,
          status: entry.status,
        })),
      }]
    case 'available_commands_update':
      return [{ type: 'session_metadata', commands: normalizeAcpCommands(update.availableCommands) }]
    case 'config_option_update':
      return [{ type: 'session_metadata', configOptions: normalizeAcpConfig(update.configOptions) }]
    case 'usage_update':
      return [{
        type: 'usage',
        usage: {
          contextUsed: update.used,
          contextSize: update.size,
          cost: update.cost ? { amount: update.cost.amount, currency: update.cost.currency } : undefined,
        },
      }]
    case 'current_mode_update':
      return [{
        type: 'diagnostic',
        level: 'info',
        message: `${harness} switched to mode ${update.currentModeId}.`,
      }]
    case 'session_info_update':
      return update.title
        ? [{ type: 'diagnostic', level: 'info', message: `${harness} session title: ${update.title}` }]
        : []
    case 'plan_update':
    case 'plan_removed':
      return []
  }
}

// One roster update from an `Agent` tool call. The title is dropped while it is still the bare tool
// name: the initial tool_call is titled "Task" and the refining update replaces it with the
// description, so passing the placeholder through would flicker every row through "Task" first.
function subagentFromToolCall(
  toolCallId: string,
  title: string | null | undefined,
  status: AgentToolCall['status'],
  meta: ClaudeToolMeta,
): AgentSubagentUpdate {
  const summary = meta.subagent
  // `contextUsed` rather than input/output tokens: the summary reports one total, and splitting a
  // total across two fields would invent a breakdown the wire never gave us.
  const usage: AgentUsage | undefined = summary?.totalTokens == null
    ? undefined
    : { contextUsed: summary.totalTokens }
  return {
    id: toolCallId,
    title: title != null && !SUBAGENT_TOOLS.has(title) ? title : undefined,
    // A summary means the subagent is done. The update carrying it has no status of its own, and the
    // one that does say `completed` arrives separately, so take the summary's own word for it.
    status: summary
      ? summary.status == null || summary.status === 'completed' ? 'completed' : 'failed'
      : status,
    role: summary?.agentType,
    model: summary?.resolvedModel,
    providerAgentRef: summary?.agentId,
    usage,
    toolUseCount: summary?.totalToolUseCount,
    durationMs: summary?.totalDurationMs,
  }
}
