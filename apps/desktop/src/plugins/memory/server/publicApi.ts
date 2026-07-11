import { z } from 'zod'
import { IdSchema, PageSchema } from '../../../core/shared/publicApi/primitives'
import {
  MemoryEntriesQuerySchema,
  MemoryEntrySchema,
  MemoryInputSchema,
  MemoryProposalSchema,
  MemorySearchSchema,
  MemorySummarySchema,
  ProposalsQuerySchema,
  ResolveProposalResultSchema,
  ResolveProposalSchema,
} from '../../../core/shared/publicApi/memory'
import { defineEndpoint, type PluginApiContribution } from '../../../core/server/publicApi/defineEndpoint'
import type { MemoryService } from '../main/memoryService'

// Memory plugin public API (docs/next/api/plugin-api.md §10). Base /plugins/memory.

const PLUGIN = 'memory'

const toSummary = (e: z.infer<typeof MemoryEntrySchema>): z.infer<typeof MemorySummarySchema> => ({
  id: e.id,
  scope: e.scope,
  repo: e.repo,
  name: e.name,
  type: e.type,
  description: e.description,
  updatedAt: e.updatedAt,
})

export function buildMemoryPublicApi(memory: MemoryService): PluginApiContribution {
  return {
    pluginId: PLUGIN,
    endpoints: [
      defineEndpoint({
        operationId: 'memory.entries.list',
        pluginId: PLUGIN,
        method: 'GET',
        path: '/entries',
        scope: 'read',
        risk: 'read',
        summary: 'List memory entries',
        query: MemoryEntriesQuerySchema,
        response: PageSchema(MemorySummarySchema),
        handler: async (_ctx, { query }) => {
          const items = (await memory.listEntries({ repo: query.repo, type: query.type })).map(toSummary)
          return { items: items.slice(0, query.limit), nextCursor: null }
        },
      }),
      defineEndpoint({
        operationId: 'memory.search',
        pluginId: PLUGIN,
        method: 'POST',
        path: '/search',
        scope: 'read', // read even though POST carries the query
        risk: 'read',
        summary: 'Ranked memory search',
        body: MemorySearchSchema,
        response: z.strictObject({ items: z.array(MemoryEntrySchema) }),
        handler: async (_ctx, { body }) => ({ items: await memory.search(body) }),
      }),
      defineEndpoint({
        operationId: 'memory.entries.create',
        pluginId: PLUGIN,
        method: 'POST',
        path: '/tasks/:taskId/entries',
        scope: 'write',
        risk: 'write',
        summary: 'Create a memory entry',
        idempotency: 'required',
        params: z.strictObject({ taskId: IdSchema }),
        body: MemoryInputSchema,
        response: MemoryEntrySchema,
        status: 201,
        handler: (_ctx, { params, body }) => memory.createEntry(params.taskId, body),
      }),
      defineEndpoint({
        operationId: 'memory.proposals.list',
        pluginId: PLUGIN,
        method: 'GET',
        path: '/proposals',
        scope: 'read',
        risk: 'read',
        summary: 'List memory proposals',
        query: ProposalsQuerySchema,
        response: PageSchema(MemoryProposalSchema),
        handler: async (_ctx, { query }) => {
          const items = await memory.listProposals({ taskId: query.taskId })
          return { items: items.slice(0, query.limit), nextCursor: null }
        },
      }),
      defineEndpoint({
        operationId: 'memory.proposals.resolve',
        pluginId: PLUGIN,
        method: 'POST',
        path: '/proposals/:proposalId/resolve',
        scope: 'write',
        risk: 'write',
        summary: 'Approve or reject a memory proposal',
        params: z.strictObject({ proposalId: z.string().min(1).max(128) }),
        body: ResolveProposalSchema,
        response: ResolveProposalResultSchema,
        handler: (_ctx, { params, body }) => memory.resolveProposal(params.proposalId, body),
      }),
    ],
  }
}
