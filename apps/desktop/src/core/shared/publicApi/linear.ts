import { z } from 'zod'
import { IdSchema, PageQuerySchema, UnixMillisSchema } from './primitives'

// Linear provider public schemas (docs/next/api/plugin-api.md §7).

export const LinearStateSchema = z.strictObject({ name: z.string(), type: z.string(), color: z.string() }).nullable()

export const LinearIssueSummarySchema = z.strictObject({
  identifier: z.string(),
  title: z.string(),
  url: z.url(),
  state: LinearStateSchema,
  assignee: z.string().nullable(),
})

export const LinearProjectSchema = z.strictObject({
  integrationId: IdSchema,
  id: z.string(),
  name: z.string(),
})

export const LinearCommentSchema = z.strictObject({
  id: z.string(),
  author: z.string().nullable(),
  body: z.string(),
  createdAt: UnixMillisSchema.nullable(),
  parentId: z.string().nullable(),
})

export const LinearIssueDetailSchema = LinearIssueSummarySchema.extend({
  id: z.string(),
  description: z.string().nullable(),
  comments: z.array(LinearCommentSchema),
  activity: z.array(z.unknown()),
})

export const LinearProjectsQuerySchema = z.strictObject({ connectionId: IdSchema.optional() })
export const LinearProjectIssuesQuerySchema = PageQuerySchema.extend({ connectionId: IdSchema })
export const LinearIssueQuerySchema = z.strictObject({
  connectionId: IdSchema,
  refresh: z.enum(['true', 'false']).default('false'),
})

export const ResolveLinearIssuesSchema = z.strictObject({
  connectionId: IdSchema.optional(),
  identifiers: z.array(z.string().min(1)).min(1).max(100),
})

export const CreateLinearCommentSchema = z.strictObject({
  connectionId: IdSchema.optional(),
  body: z.string().trim().min(1).max(1_000_000),
  parentId: z.string().optional(),
})
