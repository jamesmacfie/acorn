import { z } from 'zod'
import { IdSchema, PageQuerySchema, UnixMillisSchema } from './primitives'

// Linear provider public schemas (docs/public-api.md).

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

export const LinearLabelSchema = z.strictObject({ id: z.string(), name: z.string(), color: z.string() })

export const LinearAttachmentSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  // Attachment URLs are arbitrary external-integration strings (custom schemes, deep links) that the
  // provider passes through unvalidated — a strict z.url() here would fail the whole detail response.
  url: z.string(),
  sourceType: z.string().nullable(),
})

export const LinearRelatedIssueSchema = z.strictObject({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  state: LinearStateSchema,
})

export const LinearRelationSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(['blocks', 'blocked-by', 'duplicate', 'duplicated-by', 'related']),
  label: z.string(),
  issue: LinearRelatedIssueSchema,
})

// New context fields are `.optional()`: fresh reads always include them, but short-TTL cached rows
// written before this change (and older detail shapes) stay valid against this strict schema.
export const LinearIssueDetailSchema = LinearIssueSummarySchema.extend({
  id: z.string(),
  description: z.string().nullable(),
  comments: z.array(LinearCommentSchema),
  activity: z.array(z.unknown()),
  labels: z.array(LinearLabelSchema).optional(),
  createdAt: UnixMillisSchema.nullable().optional(),
  updatedAt: UnixMillisSchema.nullable().optional(),
  creator: z.string().nullable().optional(),
  priority: z.number().nullable().optional(),
  priorityLabel: z.string().nullable().optional(),
  estimate: z.number().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  branchName: z.string().nullable().optional(),
  team: z.strictObject({ key: z.string(), name: z.string() }).nullable().optional(),
  project: z.strictObject({ id: z.string(), name: z.string() }).nullable().optional(),
  cycle: z.strictObject({ number: z.number(), endsAt: z.string().nullable() }).nullable().optional(),
  attachments: z.array(LinearAttachmentSchema).optional(),
  parent: LinearRelatedIssueSchema.nullable().optional(),
  children: z.array(LinearRelatedIssueSchema).optional(),
  relations: z.array(LinearRelationSchema).optional(),
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
