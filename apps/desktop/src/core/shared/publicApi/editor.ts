import { z } from 'zod'
import { RelativePathSchema } from './primitives'

// Editor + search plugin public schemas (docs/public-api.md). All paths are
// worktree-relative and confined server-side.

export const FileEntrySchema = z.strictObject({
  name: z.string(),
  path: RelativePathSchema,
  kind: z.enum(['file', 'directory']),
})

export const FileContentSchema = z.strictObject({
  path: RelativePathSchema,
  content: z.string(),
  encoding: z.literal('utf8'),
  version: z.string(), // content hash for optimistic writes
})

export const WriteFileSchema = z.strictObject({
  content: z.string().max(10_485_760),
  expectedVersion: z.string().optional(),
})

export const EditorRootSchema = z.strictObject({
  // basename only — never the absolute worktree path (review checklist: no absolute paths exposed).
  name: z.string().nullable(),
  exists: z.boolean(),
})

export const FilesQuerySchema = z.strictObject({
  query: z.string().max(4096).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
  cursor: z.string().min(1).max(2048).optional(),
})

export const EntriesQuerySchema = z.strictObject({
  path: RelativePathSchema.optional(),
})

export const FilePathQuerySchema = z.strictObject({
  path: RelativePathSchema,
})

export const SearchSchema = z.strictObject({
  query: z.string().min(1).max(4096),
  glob: z.string().max(4096).optional(),
  caseSensitive: z.boolean().default(false),
  maxResults: z.number().int().min(1).max(1000).default(200),
})

export const SearchMatchSchema = z.strictObject({
  path: RelativePathSchema,
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  preview: z.string().max(20_000),
})

export const SearchResponseSchema = z.strictObject({
  matches: z.array(SearchMatchSchema),
  truncated: z.boolean(),
})
