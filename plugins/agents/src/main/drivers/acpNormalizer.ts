import type {
  AvailableCommand,
  RequestPermissionRequest,
  SessionConfigOption,
  SessionUpdate,
} from '@agentclientprotocol/sdk'
import type {
  AgentCommandDescriptor,
  AgentConfigOption,
  AgentNormalizedEvent,
  AgentPermissionOption,
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
// 0.54.1 (drivers/testFixtures/claudeSubagentWire.json):
//   toolName          the CLI's own name for the tool, on every tool_call and most updates
//   parentToolUseId   the spawning `Agent` call, on everything a subagent did
//   toolResponse      the structured result; for a subagent it names the agent and reports its usage
type ClaudeToolMeta = {
  toolName?: string
  parentToolUseId?: string
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

// Absent stays absent. ACP sends a status only when it changes, so an update that carries nothing but
// command output would otherwise reset a finished call to running once the transcript folds the two.
function toolStatus(status: string | null | undefined): AgentToolCall['status'] {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'pending') return 'pending'
  if (status === 'in_progress') return 'running'
  return undefined
}

// `harness` is the label of the agent whose events these are, and it is a parameter rather than a
// constant because this file is the shared half of the generic driver (main/drivers/acpDriver.ts). It
// used to write "Claude" into three user-visible strings, which would have named the wrong agent for
// every harness the moment a second one arrived.
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
      const blocks = update.content ?? []
      // A command's stdout arrives as inline text blocks, because Acorn declines ACP's terminal
      // capability, so this is the only place it can be picked up. The card renders it behind a
      // disclosure toggle. `content` replaces rather than appends in ACP, hence no outputAppend.
      const text = blocks
        .flatMap((content) => content.type === 'content' && content.content.type === 'text'
          ? [unfenced(content.content.text)]
          : [])
        .join('\n')
      const meta = claudeToolMeta(update._meta)
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
