import { z } from 'zod'
import { type AgentToolContribution, type CoreServices, ToolError } from '@acorn/plugin-api/node'
import { DIRECT_MEMORY_TYPES } from './memory'
import type { MemoryScope } from '../contract/library'
import type { MemoryStoreAccess } from './memoryStore'
import type { MemoryWrite } from './memorySafety'

const scopeSchema = z.enum(['project', 'private'])
const addressSchema = z.object({ scope: scopeSchema, name: z.string() })

export function memoryAgentTools(store: MemoryStoreAccess, core: Pick<CoreServices, 'tasks'>): AgentToolContribution[] {
  const projectFor = async (taskId: string, scope?: MemoryScope) => {
    const task = await core.tasks.load(taskId)
    if (!task) throw new ToolError('not_found', 'No such task.')
    if (scope === 'project' && !task.projectId) throw new ToolError('bad_request', 'Task has no project. Use private scope.')
    return task.projectId ?? null
  }
  return [
    {
      name: 'memory_list', description: 'List memory names, descriptions, types and update dates. Use when the standing index is truncated or stale.',
      input: z.object({ scope: scopeSchema.optional() }), scope: 'task', risk: 'read',
      handler: async (a, ctx) => {
        const { scope } = a as { scope?: MemoryScope }
        const rows = await store.list(await projectFor(ctx.taskId, scope), scope)
        return rows.map(({ name, description, type, updatedAt, scope }) => ({ name, description, type, updatedAt, scope }))
      },
    },
    {
      name: 'memory_search', description: 'Search names, descriptions and bodies in project and private memory. Returns up to ten matches with excerpts.',
      input: z.object({ query: z.string(), scope: scopeSchema.optional() }), scope: 'task', risk: 'read',
      handler: async (a, ctx) => {
        const { query, scope } = a as { query: string; scope?: MemoryScope }
        return store.search(await projectFor(ctx.taskId, scope), query, scope)
      },
    },
    {
      name: 'memory_get', description: 'Read a memory and its hash. Read before updating or deleting.',
      input: addressSchema, scope: 'task', risk: 'read',
      handler: async (a, ctx) => {
        const { scope, name } = a as { scope: MemoryScope; name: string }
        const project = await projectFor(ctx.taskId, scope)
        const memory = await store.get({ scope, name, projectId: scope === 'project' ? project : null })
        if (!memory) throw new ToolError('not_found', 'No such memory.')
        return memory
      },
    },
    ...(['write', 'delete'] as const).map((action): AgentToolContribution => ({
      name: `memory_${action}`,
      description: action === 'write'
        ? 'Save durable memory directly. Use project scope for codebase facts, private for the person. Updating an existing name requires its current hash from memory_get.'
        : 'Delete a memory using its current hash from memory_get. The owner can undo it.',
      input: action === 'write'
        ? addressSchema.extend({ description: z.string(), type: z.enum(DIRECT_MEMORY_TYPES), body: z.string(), hash: z.string().optional() })
        : addressSchema.extend({ hash: z.string().min(1) }),
      scope: 'task', risk: 'write', requiresSession: true,
      handler: async (a, ctx) => {
        if (!ctx.sessionId || !ctx.provenanceProof) throw new ToolError('failed', 'Authenticated agent session is required.')
        const input = a as MemoryWrite & { scope: MemoryScope; hash: string }
        const project = await projectFor(ctx.taskId, input.scope)
        const address = { scope: input.scope, name: input.name, projectId: input.scope === 'project' ? project : null }
        const author = { by: 'agent' as const, sessionId: ctx.sessionId, taskId: ctx.taskId }
        return action === 'write' ? store.write(address, input, author) : store.delete(address, input.hash, author)
      },
    })),
  ]
}
