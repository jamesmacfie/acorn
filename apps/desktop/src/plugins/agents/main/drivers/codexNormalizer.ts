import type {
  AgentNormalizedEvent,
  AgentPermissionOption,
  AgentPlanEntry,
  AgentQuestion,
  AgentToolCall,
} from '../../../../core/shared/managedAgents'
import type { JsonRpcNotification, JsonRpcServerRequest } from './jsonRpcProcess'

type JsonObject = Record<string, unknown>

export const asObject = (value: unknown): JsonObject | null =>
  typeof value === 'object' && value != null && !Array.isArray(value) ? value as JsonObject : null

const stringValue = (value: unknown): string | null => typeof value === 'string' ? value : null
const numberValue = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null

function toolFromItem(item: JsonObject, completed: boolean): AgentToolCall | null {
  const type = stringValue(item.type)
  const id = stringValue(item.id)
  if (!type || !id) return null
  const status = completed
    ? stringValue(item.status) === 'failed'
      ? 'failed'
      : 'completed'
    : 'running'
  switch (type) {
    case 'commandExecution':
      return {
        id,
        title: stringValue(item.command) ?? 'Command',
        kind: 'execute',
        status,
        input: stringValue(item.command) ?? undefined,
        output: completed ? stringValue(item.aggregatedOutput) ?? undefined : undefined,
      }
    case 'fileChange': {
      const paths = Array.isArray(item.changes)
        ? item.changes.flatMap((change) => {
            const row = asObject(change)
            const path = stringValue(row?.path)
            return path ? [path] : []
          })
        : []
      return { id, title: paths.length ? `Changed ${paths.join(', ')}` : 'File changes', kind: 'edit', status, paths }
    }
    case 'mcpToolCall':
      return {
        id,
        title: `${stringValue(item.server) ?? 'MCP'} · ${stringValue(item.tool) ?? 'tool'}`,
        kind: 'mcp',
        status,
        input: item.arguments == null ? undefined : JSON.stringify(item.arguments),
        output: completed && item.result != null ? JSON.stringify(item.result) : undefined,
      }
    case 'dynamicToolCall':
      return {
        id,
        title: [stringValue(item.namespace), stringValue(item.tool)].filter(Boolean).join(' · ') || 'Tool',
        kind: 'tool',
        status,
        input: item.arguments == null ? undefined : JSON.stringify(item.arguments),
        output: completed && item.contentItems != null ? JSON.stringify(item.contentItems) : undefined,
      }
    case 'collabAgentToolCall':
      return {
        id,
        title: `Agent ${stringValue(item.tool) ?? 'collaboration'}`,
        kind: 'subagent',
        status,
        input: stringValue(item.prompt) ?? undefined,
      }
    case 'webSearch':
      return { id, title: 'Web search', kind: 'search', status }
    case 'imageView':
      return { id, title: `Viewed ${stringValue(item.path) ?? 'image'}`, kind: 'read', status }
    case 'imageGeneration':
      return { id, title: 'Generated image', kind: 'image', status }
    default:
      return null
  }
}

function planEntries(value: unknown): AgentPlanEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry, index) => {
    const row = asObject(entry)
    const text = stringValue(row?.step)
    const rawStatus = stringValue(row?.status)
    if (!text) return []
    return [{
      id: `plan-${index}`,
      text,
      status: rawStatus === 'completed' ? 'completed' : rawStatus === 'inProgress' ? 'in_progress' : 'pending',
    } satisfies AgentPlanEntry]
  })
}

export function normalizeCodexNotification(notification: JsonRpcNotification): AgentNormalizedEvent[] {
  const { method, params } = notification
  switch (method) {
    case 'thread/status/changed': {
      const status = asObject(params.status)
      const type = stringValue(status?.type)
      if (type === 'idle') return [{ type: 'session_state', state: 'ready' }]
      if (type === 'active') return [{ type: 'session_state', state: 'working' }]
      if (type === 'systemError') return [{ type: 'session_state', state: 'failed', detail: 'Codex reported a system error.' }]
      if (type === 'notLoaded') return [{ type: 'session_state', state: 'stopped' }]
      return []
    }
    case 'turn/started':
      return [{ type: 'session_state', state: 'working' }]
    case 'turn/completed': {
      const turn = asObject(params.turn)
      const status = stringValue(turn?.status)
      if (status === 'failed') {
        const error = asObject(turn?.error)
        return [{
          type: 'error',
          code: stringValue(error?.codexErrorInfo) ?? 'codex_turn_failed',
          message: stringValue(error?.message) ?? 'Codex turn failed.',
          retryable: false,
        }]
      }
      return [{ type: 'turn_completed', stopReason: status ?? 'completed' }]
    }
    case 'item/agentMessage/delta':
      return [{
        type: 'assistant_message',
        text: stringValue(params.delta) ?? '',
        messageId: stringValue(params.itemId) ?? undefined,
        append: true,
      }]
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta':
      return [{
        type: 'reasoning',
        text: stringValue(params.delta) ?? '',
        messageId: stringValue(params.itemId) ?? undefined,
        append: true,
      }]
    case 'item/started':
    case 'item/completed': {
      const item = asObject(params.item)
      if (!item) return []
      const tool = toolFromItem(item, method === 'item/completed')
      if (tool) {
        return [
          { type: 'tool', tool },
          ...(method === 'item/completed' && item.type === 'fileChange'
            ? [{ type: 'file_change' as const, summary: 'Codex updated files.' }]
            : []),
        ]
      }
      if (method === 'item/completed' && item.type === 'fileChange') {
        return [{ type: 'file_change', summary: 'Codex updated files.' }]
      }
      return []
    }
    case 'item/commandExecution/outputDelta':
      return [{
        type: 'tool',
        tool: {
          id: stringValue(params.itemId) ?? 'command',
          title: 'Command output',
          kind: 'execute',
          status: 'running',
          output: stringValue(params.delta) ?? '',
          outputAppend: true,
        },
      }]
    case 'item/fileChange/patchUpdated':
      return [{
        type: 'file_change',
        path: stringValue(params.path) ?? undefined,
        patch: stringValue(params.patch) ?? stringValue(params.diff) ?? undefined,
      }]
    case 'turn/diff/updated':
      return [{ type: 'file_change', patch: stringValue(params.diff) ?? '', summary: 'Turn diff updated.' }]
    case 'turn/plan/updated':
      return [{ type: 'plan', entries: planEntries(params.plan) }]
    case 'thread/tokenUsage/updated': {
      const usage = asObject(params.tokenUsage)
      const total = asObject(usage?.total)
      return [{
        type: 'usage',
        usage: {
          inputTokens: numberValue(total?.inputTokens) ?? undefined,
          outputTokens: numberValue(total?.outputTokens) ?? undefined,
          cachedInputTokens: numberValue(total?.cachedInputTokens) ?? undefined,
          contextUsed: numberValue(total?.totalTokens) ?? undefined,
          contextSize: numberValue(usage?.modelContextWindow) ?? undefined,
        },
      }]
    }
    case 'thread/compacted':
      return [{ type: 'diagnostic', level: 'info', message: 'Codex compacted this thread’s context.' }]
    case 'warning':
    case 'guardianWarning':
    case 'configWarning':
    case 'deprecationNotice':
      return [{
        type: 'diagnostic',
        level: 'warning',
        message: stringValue(params.message) ?? stringValue(params.summary) ?? 'Codex reported a warning.',
      }]
    case 'error': {
      const error = asObject(params.error)
      return [{
        type: 'error',
        code: stringValue(error?.codexErrorInfo) ?? 'codex_error',
        message: stringValue(params.message) ?? stringValue(error?.message) ?? 'Codex reported an error.',
        retryable: Boolean(params.willRetry),
      }]
    }
    default:
      return []
  }
}

const approvalOptions: AgentPermissionOption[] = [
  { id: 'accept', label: 'Allow once', kind: 'allow_once' },
  { id: 'acceptForSession', label: 'Allow for session', kind: 'allow_always' },
  { id: 'decline', label: 'Reject', kind: 'reject_once' },
  { id: 'cancel', label: 'Cancel turn', kind: 'reject_once' },
]

export function normalizeCodexServerRequest(request: JsonRpcServerRequest): AgentNormalizedEvent | null {
  const requestId = String(request.id)
  switch (request.method) {
    case 'item/commandExecution/requestApproval':
      return {
        type: 'request',
        requestId,
        kind: 'permission',
        title: 'Allow command?',
        detail: stringValue(request.params.command) ?? stringValue(request.params.reason) ?? undefined,
        options: approvalOptions,
      }
    case 'item/fileChange/requestApproval':
      return {
        type: 'request',
        requestId,
        kind: 'permission',
        title: 'Allow file changes?',
        detail: stringValue(request.params.reason) ?? stringValue(request.params.grantRoot) ?? undefined,
        options: approvalOptions,
      }
    case 'item/permissions/requestApproval':
      return {
        type: 'request',
        requestId,
        kind: 'permission',
        title: 'Allow additional permissions?',
        detail: request.params.permissions == null ? undefined : JSON.stringify(request.params.permissions),
        options: approvalOptions,
      }
    case 'item/tool/requestUserInput': {
      const questions: AgentQuestion[] = Array.isArray(request.params.questions)
        ? request.params.questions.flatMap((value) => {
            const row = asObject(value)
            const id = stringValue(row?.id)
            const prompt = stringValue(row?.question)
            if (!id || !prompt) return []
            const options = Array.isArray(row?.options)
              ? row.options.flatMap((option, index) => {
                  const item = asObject(option)
                  const label = stringValue(item?.label)
                  return label ? [{ id: String(index), label, description: stringValue(item?.description) ?? undefined }] : []
                })
              : undefined
            return [{
              id,
              header: stringValue(row?.header) ?? undefined,
              prompt,
              options,
              secret: Boolean(row?.isSecret),
            }]
          })
        : []
      return { type: 'request', requestId, kind: 'question', title: 'Codex has a question', questions }
    }
    case 'mcpServer/elicitation/request':
      return {
        type: 'request',
        requestId,
        kind: 'elicitation',
        title: stringValue(request.params.message) ?? 'Input requested',
        detail: request.params.requestedSchema == null ? undefined : JSON.stringify(request.params.requestedSchema),
      }
    default:
      return null
  }
}

export function codexServerRequestResponse(request: JsonRpcServerRequest, resolution: unknown): unknown {
  const row = asObject(resolution)
  switch (request.method) {
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval':
      return { decision: stringValue(row?.optionId) ?? stringValue(resolution) ?? 'decline' }
    case 'item/permissions/requestApproval': {
      const optionId = stringValue(row?.optionId)
      return {
        permissions: optionId === 'accept' || optionId === 'acceptForSession'
          ? asObject(request.params.permissions) ?? {}
          : {},
        scope: optionId === 'acceptForSession' ? 'session' : 'turn',
      }
    }
    case 'item/tool/requestUserInput': {
      const rawAnswers = asObject(row?.answers) ?? {}
      return {
        answers: Object.fromEntries(Object.entries(rawAnswers).map(([id, answer]) => [
          id,
          { answers: Array.isArray(answer) ? answer.map(String) : [String(answer ?? '')] },
        ])),
      }
    }
    case 'mcpServer/elicitation/request':
      return row ?? { action: 'cancel' }
    default:
      return row ?? {}
  }
}
