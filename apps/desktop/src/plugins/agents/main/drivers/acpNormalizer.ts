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
} from '../../../../core/shared/managedAgents'

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

function toolStatus(status: string | null | undefined): 'pending' | 'running' | 'completed' | 'failed' {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'pending') return 'pending'
  return 'running'
}

export function normalizeAcpUpdate(update: SessionUpdate): AgentNormalizedEvent[] {
  switch (update.sessionUpdate) {
    case 'user_message_chunk':
      return []
    case 'agent_message_chunk':
      return update.content.type === 'text'
        ? [{ type: 'assistant_message', text: update.content.text, messageId: update.messageId ?? undefined, append: true }]
        : []
    case 'agent_thought_chunk':
      return update.content.type === 'text'
        ? [{ type: 'reasoning', text: update.content.text, messageId: update.messageId ?? undefined, append: true }]
        : []
    case 'tool_call':
    case 'tool_call_update': {
      const diffs = (update.content ?? []).flatMap((content) =>
        content.type === 'diff'
          ? [{ type: 'file_change' as const, path: content.path, summary: 'Claude updated a file.' }]
          : [])
      return [{
        type: 'tool',
        tool: {
          id: update.toolCallId,
          title: update.title ?? 'Tool',
          kind: update.kind ?? undefined,
          status: toolStatus(update.status),
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
        message: `Claude switched to mode ${update.currentModeId}.`,
      }]
    case 'session_info_update':
      return update.title
        ? [{ type: 'diagnostic', level: 'info', message: `Claude session title: ${update.title}` }]
        : []
    case 'plan_update':
    case 'plan_removed':
      return []
  }
}
