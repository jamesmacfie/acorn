import { Buffer } from 'node:buffer'
import type {
  AgentNormalizedEvent,
  AgentPermissionOption,
  AgentPlanEntry,
  AgentQuestion,
  AgentToolCall,
} from '@acorn/protocol/managedAgents.ts'
import type { AgentDriverGeneratedArtifact } from './types'
import type { JsonRpcNotification, JsonRpcServerRequest } from './jsonRpcProcess'
import { formElicitationResponse, normalizeFormElicitation } from './formElicitation'

type JsonObject = Record<string, unknown>

export const asObject = (value: unknown): JsonObject | null =>
  typeof value === 'object' && value != null && !Array.isArray(value) ? value as JsonObject : null

export const stringValue = (value: unknown): string | null => typeof value === 'string' ? value : null
export const numberValue = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null

const decodedBase64 = (value: string): Uint8Array | null => {
  const encoded = value.trim().replace(/^data:[^;,]+;base64,/i, '').replace(/\s/g, '')
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return null
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) return null
  return bytes
}

const generatedImageFormat = (bytes: Uint8Array): { mediaType: string; extension: string } => {
  const startsWith = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte)
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return { mediaType: 'image/png', extension: 'png' }
  }
  if (startsWith(0xff, 0xd8, 0xff)) return { mediaType: 'image/jpeg', extension: 'jpg' }
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return { mediaType: 'image/gif', extension: 'gif' }
  if (
    startsWith(0x52, 0x49, 0x46, 0x46)
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return { mediaType: 'image/webp', extension: 'webp' }
  return { mediaType: 'application/octet-stream', extension: 'bin' }
}

/** The provider-specific half of the generated-artifact seam. The returned bytes are transient. */
export function codexGeneratedArtifact(notification: JsonRpcNotification): AgentDriverGeneratedArtifact | null {
  if (notification.method !== 'item/completed') return null
  const item = asObject(notification.params.item)
  if (stringValue(item?.type) !== 'imageGeneration') return null
  const result = stringValue(item?.result)
  const bytes = result ? decodedBase64(result) : null
  if (!bytes) return null
  const format = generatedImageFormat(bytes)
  return {
    type: 'generated_artifact',
    kind: 'file',
    title: `Generated image.${format.extension}`,
    mediaType: format.mediaType,
    bytes,
  }
}

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
    // The parent's own inter-agent tool, NOT the spawn: a live capture shows `tool: "wait"` with a null
    // prompt and an empty receiver list while the session blocks on its children. The spawn arrives as
    // a `subAgentActivity` item, which codexChildRouting.ts owns. This used to be titled "Agent wait"
    // with `kind: 'subagent'`, which named the wrong thing twice.
    case 'collabAgentToolCall': {
      const tool = stringValue(item.tool)
      return {
        id,
        title: tool === 'wait' ? 'Waiting for subagents' : `Subagents · ${tool ?? 'coordinate'}`,
        kind: 'tool',
        status,
        input: stringValue(item.prompt) ?? undefined,
      }
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
      return normalizeFormElicitation(requestId, {
        message: stringValue(request.params.message) ?? 'Input requested',
        requestedSchema: request.params.requestedSchema,
      })
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
      return formElicitationResponse({
        message: stringValue(request.params.message) ?? 'Input requested',
        requestedSchema: request.params.requestedSchema,
      }, resolution)
    default:
      return row ?? {}
  }
}
