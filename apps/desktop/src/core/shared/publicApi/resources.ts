import { z } from 'zod'
import { BranchSchema, IdSchema, OwnerSchema, PageQuerySchema, RelativePathSchema, RepoNameSchema, UnixMillisSchema } from './primitives'

// Core resource schemas (docs/next/api/core-api.md §1, §5–§8). Workspaces, tasks, links, repository
// assignments, and pinned repositories.

export const WorkspaceIconSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('emoji'), value: z.string().min(1).max(16) }),
  z.strictObject({ kind: z.literal('lucide'), value: z.string().min(1).max(80) }),
  z.strictObject({ kind: z.literal('github') }),
])

export const WorkspaceRepoSchema = z.strictObject({
  owner: OwnerSchema,
  name: RepoNameSchema,
  sort: z.number().int().nonnegative(),
})

export const WorkspaceSchema = z.strictObject({
  id: IdSchema,
  name: z.string().min(1).max(120),
  isDefault: z.boolean(),
  sort: z.number().int().nonnegative(),
  setupScript: z.string().nullable(),
  setupScriptTrigger: z.enum(['off', 'created', 'terminal']).nullable(),
  devScript: z.string().nullable(),
  devRestartScript: z.string().nullable(),
  teardownScript: z.string().nullable(),
  dbUrlScript: z.string().nullable(),
  previewMode: z.enum(['url', 'port', 'script']).nullable(),
  previewValue: z.string().nullable(),
  icon: WorkspaceIconSchema.nullable(),
  color: z.string().nullable(),
  repos: z.array(WorkspaceRepoSchema).max(10_000),
  createdAt: UnixMillisSchema,
  updatedAt: UnixMillisSchema,
})
export type Workspace = z.infer<typeof WorkspaceSchema>

export const CreateWorkspaceSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  icon: WorkspaceIconSchema.nullable().optional(),
  color: z.string().nullable().optional(),
})

export const PatchWorkspaceSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120).optional(),
    sort: z.number().int().nonnegative().optional(),
    setupScript: z.string().max(100_000).nullable().optional(),
    setupScriptTrigger: z.enum(['off', 'created', 'terminal']).nullable().optional(),
    devScript: z.string().max(100_000).nullable().optional(),
    devRestartScript: z.string().max(100_000).nullable().optional(),
    teardownScript: z.string().max(100_000).nullable().optional(),
    dbUrlScript: z.string().max(100_000).nullable().optional(),
    previewMode: z.enum(['url', 'port', 'script']).nullable().optional(),
    previewValue: z.string().max(4096).nullable().optional(),
    icon: WorkspaceIconSchema.nullable().optional(),
    color: z.string().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required')

export const WorkspaceProjectSchema = z.strictObject({
  integrationId: IdSchema,
  externalId: z.string().min(1).max(1024),
})
export const ReplaceWorkspaceProjectsSchema = z.strictObject({
  projects: z.array(WorkspaceProjectSchema).max(1_000),
})
export const WorkspaceProjectsResponseSchema = z.strictObject({ projects: z.array(WorkspaceProjectSchema) })

// --- Tasks ---

export const ExternalRefSchema = z.strictObject({
  providerId: z.string().min(1).max(100),
  connectionId: IdSchema,
  displayId: z.string().min(1).max(512),
  externalId: z.string().min(1).max(1024).optional(),
  url: z.url().optional(),
  locator: z.record(z.string().min(1).max(100), z.string().max(4096)).optional(),
})

export const TaskLinkSchema = z.strictObject({
  connectionId: IdSchema,
  providerId: z.string().min(1).max(100),
  identifier: z.string().min(1).max(512),
  ref: ExternalRefSchema.optional(),
})

export const TaskLinkInputSchema = z.strictObject({
  connectionId: IdSchema,
  identifier: z.string().min(1).max(512),
  providerId: z.string().min(1).max(100).optional(),
  ref: z
    .strictObject({
      displayId: z.string().min(1).max(512),
      externalId: z.string().min(1).max(1024).optional(),
      url: z.url().optional(),
      locator: z.record(z.string().min(1).max(100), z.string().max(4096)).optional(),
    })
    .optional(),
})

export const TaskSchema = z.strictObject({
  id: IdSchema,
  title: z.string().min(1).max(240),
  origin: z.string().min(1).max(100),
  repoOwner: OwnerSchema,
  repoName: RepoNameSchema,
  branch: BranchSchema,
  worktreePath: z.string().nullable(),
  pullNumber: z.number().int().positive().nullable(),
  status: z.enum(['active', 'archived', 'cancelled']),
  parentId: IdSchema.nullable(),
  sort: z.number().int().nonnegative(),
  links: z.array(TaskLinkSchema).max(100),
  createdAt: UnixMillisSchema,
  updatedAt: UnixMillisSchema,
  archivedAt: UnixMillisSchema.nullable(),
})
export type Task = z.infer<typeof TaskSchema>

export const CreateTaskSchema = z.strictObject({
  title: z.string().trim().min(1).max(240).optional(),
  origin: z.string().min(1).max(100),
  repoOwner: OwnerSchema,
  repoName: RepoNameSchema,
  branch: BranchSchema,
  pullNumber: z.number().int().positive().optional(),
  links: z.array(TaskLinkInputSchema).max(100).default([]),
  checkout: z
    .discriminatedUnion('mode', [
      z.strictObject({ mode: z.literal('lazy-worktree') }),
      z.strictObject({ mode: z.literal('create-worktree') }),
      z.strictObject({ mode: z.literal('current-checkout') }),
    ])
    .default({ mode: 'lazy-worktree' }),
})

export const PatchTaskSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(240).optional(),
    sort: z.number().int().nonnegative().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required')

export const ArchiveTaskSchema = z.strictObject({
  deleteWorktree: z.boolean().default(true),
  force: z.boolean().default(false),
  skipTeardown: z.boolean().default(false),
})

export const TaskStatusSchema = z.strictObject({
  taskId: IdSchema,
  worktreePath: z.string().nullable(),
  dirty: z.boolean(),
  dirtyCount: z.number().int().nonnegative(),
  missing: z.boolean(),
  runningSessionCount: z.number().int().nonnegative(),
  runningWorkflowCount: z.number().int().nonnegative(),
})

export const TaskListQuerySchema = PageQuerySchema.extend({
  status: z.enum(['active', 'archived', 'cancelled', 'all']).default('active'),
  workspaceId: IdSchema.optional(),
  repoOwner: OwnerSchema.optional(),
  repoName: RepoNameSchema.optional(),
  parentId: IdSchema.optional(),
})

// --- Repository assignments ---

export const RepositoryAssignmentSchema = z.strictObject({
  owner: OwnerSchema,
  name: RepoNameSchema,
  workspaceId: IdSchema,
  ignored: z.boolean(),
  sort: z.number().int().nonnegative(),
})

export const PutRepositoryAssignmentSchema = z.strictObject({
  workspaceId: IdSchema,
  ignored: z.boolean().default(false),
  sort: z.number().int().nonnegative().default(0),
})

export const PatchRepositoryAssignmentSchema = z
  .strictObject({
    workspaceId: IdSchema.optional(),
    ignored: z.boolean().optional(),
    sort: z.number().int().nonnegative().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required')

export const RepositoryAssignmentQuerySchema = PageQuerySchema.extend({
  workspaceId: IdSchema.optional(),
  ignored: z.enum(['true', 'false']).optional(),
})

// --- Pinned repositories ---

export const PinnedRepoSchema = z.strictObject({
  owner: OwnerSchema,
  name: RepoNameSchema,
  sort: z.number().int().nonnegative(),
})
export const ReplacePinnedReposSchema = z.strictObject({
  repos: z.array(PinnedRepoSchema.omit({ sort: true })).max(1000),
})
