import { z } from 'zod'
import { IdSchema, PageQuerySchema, UnixMillisSchema } from './primitives'

// Rollbar provider public schemas (docs/public-api.md). Read-only in v1 — the pane has no write
// action. List returns summaries; get returns the full privacy-normalized detail. These MUST match
// the RollbarItemSummary / RollbarItemDetail contracts in core/shared/api.ts.

export const RollbarItemSummarySchema = z.strictObject({
  integrationId: IdSchema,
  integrationLabel: z.string(),
  identifier: z.string(),
  itemId: z.string(),
  url: z.string().url().nullable(),
  title: z.string(),
  level: z.string(),
  environment: z.string(),
  status: z.string(),
  totalOccurrences: z.number().int().nonnegative(),
  firstOccurrenceAt: UnixMillisSchema.nullable(),
  lastOccurrenceAt: UnixMillisSchema.nullable(),
  framework: z.string().optional(),
  lastActivatedAt: UnixMillisSchema.nullable().optional(),
  uniqueOccurrences: z.number().int().nonnegative().optional(),
})

const RollbarStackFrameSchema = z.strictObject({
  filename: z.string(),
  line: z.number().nullable(),
  column: z.number().nullable(),
  method: z.string().nullable(),
  code: z.array(z.strictObject({ line: z.number(), text: z.string() })),
  inProject: z.boolean().nullable(),
})

const RollbarOccurrenceDetailSchema = z.strictObject({
  id: z.string(),
  occurredAt: UnixMillisSchema.nullable(),
  uuid: z.string().nullable(),
  url: z.string().url().nullable(),
  kind: z.enum(['trace', 'trace-chain', 'message', 'crash-report', 'unknown']),
  exceptionClass: z.string().nullable(),
  message: z.string().nullable(),
  frames: z.array(RollbarStackFrameSchema),
  request: z.strictObject({ method: z.string().nullable(), url: z.string().nullable() }).nullable(),
  context: z.string().nullable(),
  environment: z.string().nullable().optional(),
  codeVersion: z.string().nullable(),
  platform: z.string().nullable(),
  language: z.string().nullable(),
  framework: z.string().nullable(),
  server: z.strictObject({ host: z.string().nullable(), branch: z.string().nullable() }).nullable(),
  person: z.strictObject({ id: z.string().nullable(), username: z.string().nullable(), email: z.string().nullable() }).nullable(),
  notifier: z.strictObject({ name: z.string().nullable(), version: z.string().nullable() }).nullable(),
  truncated: z.boolean(),
})

export const RollbarItemDetailSchema = RollbarItemSummarySchema.extend({
  resolvedInVersion: z.string().nullable(),
  assignedTo: z.string().nullable(),
  latestOccurrence: RollbarOccurrenceDetailSchema.nullable(),
})

export const RollbarItemsQuerySchema = PageQuerySchema.extend({
  connectionId: IdSchema.optional(),
  status: z.string().max(100).optional(),
})

export const RollbarItemQuerySchema = z.strictObject({
  connectionId: IdSchema,
  refresh: z.enum(['true', 'false']).default('false'),
})
