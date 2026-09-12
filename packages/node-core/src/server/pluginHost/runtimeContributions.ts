import { z } from 'zod'
import type { PluginAgentToolDescriptor, PluginContextSectionDescriptor } from '@acorn/protocol/plugin/runtimeContributions.ts'
import { qualifiedPluginContextSectionId, qualifiedPluginToolName } from '@acorn/protocol/plugin/runtimeContributions.ts'
import type { ContextItem } from '@acorn/protocol/api.ts'
import type { Env } from '../bindings'
import { ToolError, type AgentToolContribution, type ToolContext } from '../agentTools/registry'
import { ContextSectionAssemblyError, type PluginContextSection } from '../agentTools/contextSections'
import { dispatchPluginRoute } from './dispatch'
import type { Principal } from '../middleware/auth'

const sourceSchema = z.object({ label: z.string().min(1).max(200), uri: z.string().max(2_048).optional() }).strict()
const itemSchema = z.object({
  id: z.string().min(1).max(200),
  kind: z.string().min(1).max(80),
  label: z.string().min(1).max(500),
  body: z.string().optional(),
  details: z.array(z.string().max(2_000)).max(20).optional(),
  sources: z.array(sourceSchema).max(20).optional(),
}).strict()
const sectionResponseSchema = z.object({
  items: z.array(itemSchema).max(100).default([]),
  compact: z.string(),
  omitted: z.number().int().min(0).max(1_000_000).default(0),
  unavailable: z.object({ detail: z.string().min(1).max(500) }).strict().optional(),
}).strict()

const principalFor = (ctx: ToolContext): Principal => ({
  kind: 'internal',
  scope: 'task',
  userId: ctx.userLogin,
  taskId: ctx.taskId,
  ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
  ...(ctx.toolCeiling ? { toolCeiling: ctx.toolCeiling } : {}),
})

const responseError = async (response: Response, maxBytes: number): Promise<ToolError> => {
  const text = await boundedResponseText(response, maxBytes, () => new ToolError('failed', `Plugin handler error exceeded its ${maxBytes}-byte output limit.`))
  const body = (() => {
    try {
      return JSON.parse(text) as { error?: { code?: string; message?: string } }
    } catch {
      return null
    }
  })()
  const code = body?.error?.code
  const kind = code === 'not_found' ? 'not_found'
    : code === 'bad_request' ? 'bad_request'
      : code === 'needs-trust' ? 'needs-trust'
        : code === 'conflict' || response.status === 409 ? 'conflict'
          : response.status === 408 || response.status === 504 ? 'timeout'
            : 'failed'
  return new ToolError(kind, body?.error?.message ?? `plugin handler returned HTTP ${response.status}`)
}

const deadline = (milliseconds: number): AbortSignal => AbortSignal.timeout(milliseconds)

const beforeDeadline = async <T>(work: Promise<T>, signal: AbortSignal, message: string): Promise<T> => {
  if (signal.aborted) throw new DOMException(message, 'TimeoutError')
  return await Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException(message, 'TimeoutError')), { once: true })
    }),
  ])
}

async function boundedResponseText(response: Response, maxBytes: number, exceeded: () => Error): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw exceeded()
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    bytes += chunk.value.byteLength
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => {})
      throw exceeded()
    }
    text += decoder.decode(chunk.value, { stream: true })
  }
  return text + decoder.decode()
}

export function manifestAgentTool(env: Env, pluginId: string, descriptor: PluginAgentToolDescriptor): AgentToolContribution {
  // The manifest parser has already rejected the unsupported language. Compile once at registration;
  // safeParse below is still run for every call, like a compiled contribution's Zod schema.
  const input = z.fromJSONSchema(descriptor.inputSchema as Parameters<typeof z.fromJSONSchema>[0])
  return {
    name: qualifiedPluginToolName(pluginId, descriptor.id),
    description: descriptor.description,
    input,
    scope: 'task',
    risk: descriptor.risk,
    requiresSession: descriptor.requiresSession,
    handler: async (args, context) => {
      const signal = deadline(descriptor.timeoutMs)
      let response: Response
      try {
        response = await beforeDeadline(dispatchPluginRoute(env, pluginId, descriptor.handler, {
          method: 'POST',
          body: JSON.stringify({
            arguments: args,
            origin: { taskId: context.taskId, sessionId: context.sessionId, callId: context.callId },
          }),
        }, signal, principalFor(context)), signal, `Plugin tool '${pluginId}_${descriptor.id}' timed out.`)
      } catch (error) {
        if (signal.aborted) throw new ToolError('timeout', `Plugin tool '${pluginId}_${descriptor.id}' timed out.`)
        throw error
      }
      if (!response.ok) {
        try {
          throw await beforeDeadline(
            responseError(response, descriptor.maxOutputBytes),
            signal,
            `Plugin tool '${pluginId}_${descriptor.id}' timed out.`,
          )
        } catch (error) {
          if (signal.aborted) throw new ToolError('timeout', `Plugin tool '${pluginId}_${descriptor.id}' timed out.`)
          throw error
        }
      }
      let text: string
      try {
        text = await beforeDeadline(
          boundedResponseText(response, descriptor.maxOutputBytes, () =>
            new ToolError('failed', `Plugin tool '${pluginId}_${descriptor.id}' exceeded its ${descriptor.maxOutputBytes}-byte output limit.`)),
          signal,
          `Plugin tool '${pluginId}_${descriptor.id}' timed out.`,
        )
      } catch (error) {
        if (signal.aborted) throw new ToolError('timeout', `Plugin tool '${pluginId}_${descriptor.id}' timed out.`)
        throw error
      }
      try {
        return text ? JSON.parse(text) : null
      } catch {
        throw new ToolError('failed', `Plugin tool '${pluginId}_${descriptor.id}' returned invalid JSON.`)
      }
    },
  }
}

export function manifestContextSection(env: Env, pluginId: string, descriptor: PluginContextSectionDescriptor): PluginContextSection {
  return {
    id: qualifiedPluginContextSectionId(pluginId, descriptor.id),
    label: descriptor.label,
    order: descriptor.order,
    defaultIncluded: descriptor.defaultIncluded,
    budget: { maxItems: 100, maxBytesPerItem: descriptor.maxBytes, overflow: 'omit-with-marker' },
    maxBytes: descriptor.maxBytes,
    maxTokens: descriptor.maxTokens,
    assemble: async ({ userLogin, task }) => {
      const signal = deadline(descriptor.timeoutMs)
      const principal: Principal = { kind: 'internal', scope: 'task', userId: userLogin, taskId: task.id }
      let response: Response
      try {
        response = await beforeDeadline(dispatchPluginRoute(env, pluginId, descriptor.read, {
          method: 'POST',
          body: JSON.stringify({ origin: { taskId: task.id }, scope: 'task' }),
        }, signal, principal), signal, `Context section '${descriptor.id}' timed out.`)
      } catch (error) {
        if (signal.aborted) throw new ContextSectionAssemblyError('timeout', `Context section '${descriptor.id}' timed out.`)
        throw error
      }
      if (!response.ok) throw new ContextSectionAssemblyError('unavailable', `Context section '${descriptor.id}' returned HTTP ${response.status}.`)
      let text: string
      try {
        text = await beforeDeadline(
          boundedResponseText(response, descriptor.maxBytes, () =>
            new ContextSectionAssemblyError('invalid-response', `Context section '${descriptor.id}' exceeded its ${descriptor.maxBytes}-byte response limit.`)),
          signal,
          `Context section '${descriptor.id}' timed out.`,
        )
      } catch (error) {
        if (signal.aborted) throw new ContextSectionAssemblyError('timeout', `Context section '${descriptor.id}' timed out.`)
        throw error
      }
      let value: unknown
      try {
        value = JSON.parse(text)
      } catch {
        throw new ContextSectionAssemblyError('invalid-response', `Context section '${descriptor.id}' returned invalid JSON.`)
      }
      const parsed = sectionResponseSchema.safeParse(value)
      if (!parsed.success) throw new ContextSectionAssemblyError('invalid-response', `Context section '${descriptor.id}' returned an invalid response: ${parsed.error.issues[0]?.message ?? 'invalid data'}`)
      return {
        items: parsed.data.items as ContextItem[],
        absent: parsed.data.unavailable ? { reason: 'unavailable', detail: parsed.data.unavailable.detail } : undefined,
        compact: parsed.data.compact,
        omitted: parsed.data.omitted,
      }
    },
    // `assemble` carries the plugin-provided bounded text as data; this adapter is the fixed host
    // formatter that selects it, not executable formatter code from the package.
    format: (_items, omitted, absent) => {
      if (absent) return `## ${descriptor.label}\n- ⚠ ${absent.detail}`
      return omitted ? `## ${descriptor.label}\n- … ${omitted} more omitted` : ''
    },
  }
}
