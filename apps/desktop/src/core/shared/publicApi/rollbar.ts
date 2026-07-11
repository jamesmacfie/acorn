import { z } from 'zod'
import { IdSchema, PageQuerySchema, UnixMillisSchema } from './primitives'

// Rollbar provider public schemas (docs/next/api/plugin-api.md §7). Read-only — the shipped Rollbar
// pane has no write action, so none is invented for v1.

export const RollbarItemSchema = z.strictObject({
  integrationId: IdSchema,
  identifier: z.string(),
  title: z.string(),
  level: z.string(),
  environment: z.string(),
  status: z.string(),
  totalOccurrences: z.number().int().nonnegative(),
  firstOccurrenceAt: UnixMillisSchema.nullable(),
  lastOccurrenceAt: UnixMillisSchema.nullable(),
})

export const RollbarItemsQuerySchema = PageQuerySchema.extend({
  connectionId: IdSchema.optional(),
  status: z.string().max(100).optional(),
})

export const RollbarItemQuerySchema = z.strictObject({
  connectionId: IdSchema,
  refresh: z.enum(['true', 'false']).default('false'),
})
