import { z } from 'zod'
import { RelativePathSchema } from './primitives'

// Changes (git) plugin public schemas (docs/next/api/terminal-git-files.md §7–§8). All operations
// are confined to the task's worktree; relative paths are validated here and again in the service.

export const LocalChangeSchema = z.strictObject({
  path: RelativePathSchema,
  status: z.enum(['modified', 'added', 'deleted', 'renamed', 'untracked']),
  oldPath: RelativePathSchema.optional(),
  staged: z.boolean(),
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable(),
})

export const GitStatusSchema = z.strictObject({
  changes: z.array(LocalChangeSchema),
  branch: z.string().nullable(),
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
})

export const GitPathsSchema = z.discriminatedUnion('selection', [
  z.strictObject({ selection: z.literal('paths'), paths: z.array(RelativePathSchema).min(1).max(1000) }),
  z.strictObject({ selection: z.literal('all') }),
])

export const DiscardSchema = z.discriminatedUnion('selection', [
  z.strictObject({
    selection: z.literal('paths'),
    paths: z.array(z.strictObject({ path: RelativePathSchema, untracked: z.boolean().default(false) })).min(1).max(1000),
  }),
  z.strictObject({ selection: z.literal('all'), includeUntracked: z.boolean().default(false) }),
])

export const CommitSchema = z.strictObject({ message: z.string().min(1).max(100_000) })

export const GitActionSchema = z.strictObject({
  changed: z.boolean(),
  summary: z.string().max(20_000).optional(),
})

export const CommitResultSchema = z.strictObject({
  commitSha: z.string(),
  summary: z.string().max(20_000).optional(),
})

export const GitDiffQuerySchema = z.strictObject({
  path: RelativePathSchema,
  scope: z.enum(['staged', 'unstaged']).default('unstaged'),
})

export const GitBlobQuerySchema = z.strictObject({
  path: RelativePathSchema,
  ref: z.string().min(1).max(256).optional(),
})

export const GitPatchSchema = z.strictObject({ patch: z.string() })
export const GitBlobSchema = z.strictObject({ text: z.string() })
