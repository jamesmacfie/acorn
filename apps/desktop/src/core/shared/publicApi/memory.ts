import { z } from 'zod'
import { IdSchema, PageQuerySchema, UnixMillisSchema } from './primitives'

// Memory plugin public schemas (docs/next/api/plugin-api.md §10).

export const MemorySummarySchema = z.strictObject({
  id: z.string(),
  scope: z.enum(['repo', 'private']),
  repo: z.string().nullable(),
  name: z.string(),
  type: z.string(),
  description: z.string(),
  updatedAt: UnixMillisSchema,
})
export const MemoryEntrySchema = MemorySummarySchema.extend({ body: z.string() })

export const MemoryInputSchema = z.strictObject({
  scope: z.enum(['repo', 'private']),
  name: z.string().trim().min(1).max(240),
  description: z.string().max(10_000),
  type: z.string().min(1).max(100),
  body: z.string().max(1_000_000),
})

export const MemorySearchSchema = z.strictObject({
  query: z.string().min(1).max(4096),
  repo: z.string().max(200).optional(),
  type: z.string().min(1).max(100).optional(),
  limit: z.number().int().min(1).max(100).default(20),
})

export const MemoryEntriesQuerySchema = PageQuerySchema.extend({
  repo: z.string().max(200).optional(),
  type: z.string().min(1).max(100).optional(),
})

export const MemoryProposalSchema = z.strictObject({
  id: z.string(),
  taskId: z.string(),
  repo: z.string().nullable(),
  name: z.string(),
  type: z.string(),
  description: z.string(),
  body: z.string(),
  flags: z.array(z.string()),
  status: z.enum(['pending', 'accepted', 'rejected']),
  createdAt: UnixMillisSchema,
})

export const ProposalsQuerySchema = PageQuerySchema.extend({
  taskId: IdSchema.optional(),
})

export const ResolveProposalSchema = z.discriminatedUnion('approved', [
  z.strictObject({ approved: z.literal(false) }),
  z.strictObject({
    approved: z.literal(true),
    edited: MemoryInputSchema.omit({ scope: true }).optional(),
  }),
])

export const ResolveProposalResultSchema = z.strictObject({
  resolved: z.boolean(),
  status: z.enum(['accepted', 'rejected']),
})
