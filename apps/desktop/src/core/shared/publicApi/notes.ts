import { z } from 'zod'
import { UnixMillisSchema } from './primitives'

// Notes plugin public schemas (docs/public-api.md). `version` is a content hash used
// for optimistic writes.

export const NoteSummarySchema = z.strictObject({
  slug: z.string(),
  title: z.string(),
  kind: z.string(),
  included: z.boolean(),
  updatedAt: UnixMillisSchema,
  version: z.string(),
})
export const NoteSchema = NoteSummarySchema.extend({ body: z.string() })

export const CreateNoteSchema = z.strictObject({
  title: z.string().trim().min(1).max(240),
  kind: z.string().min(1).max(100).optional(),
})

export const WriteNoteSchema = z.strictObject({
  body: z.string().max(10_485_760),
  expectedVersion: z.string().optional(),
})

export const SetIncludedSchema = z.strictObject({ included: z.boolean() })
