import { z } from 'zod'
import { BranchSchema, OwnerSchema, PageQuerySchema, RelativePathSchema, RepoNameSchema, UnixMillisSchema } from './primitives'

// GitHub plugin public schemas (docs/next/api/plugin-api.md §4–§5). Acorn's stable projection of
// mirrored GitHub data — never raw GitHub payloads.

export const RepoSchema = z.strictObject({
  id: z.number().int().positive(),
  owner: OwnerSchema,
  name: RepoNameSchema,
  private: z.boolean(),
  defaultBranch: z.string().nullable(),
  pushedAt: UnixMillisSchema.nullable(),
})

export const PullSchema = z.strictObject({
  number: z.number().int().positive(),
  title: z.string(),
  state: z.string(),
  draft: z.boolean(),
  author: z.string().nullable(),
  headRef: z.string().nullable(),
  baseRef: z.string().nullable(),
  updatedAt: UnixMillisSchema.nullable(),
  mergeable: z.string().nullable(),
  mergeStateStatus: z.string().nullable(),
  autoMergeEnabled: z.boolean(),
})

export const PullFileSchema = z.strictObject({
  path: RelativePathSchema,
  status: z.string().nullable(),
  additions: z.number().int().nullable(),
  deletions: z.number().int().nullable(),
  sha: z.string().nullable(),
  viewed: z.boolean(),
  patch: z.string().nullable(),
})

export const ReviewSchema = z.strictObject({
  id: z.string(),
  author: z.string().nullable(),
  state: z.string().nullable(),
  body: z.string().nullable(),
  submittedAt: UnixMillisSchema.nullable(),
})

export const CommentSchema = z.strictObject({
  id: z.string(),
  author: z.string().nullable(),
  body: z.string().nullable(),
  createdAt: UnixMillisSchema.nullable(),
})

export const ThreadCommentSchema = z.strictObject({
  id: z.string(),
  databaseId: z.number().int().nullable(),
  author: z.string().nullable(),
  body: z.string().nullable(),
  createdAt: UnixMillisSchema.nullable(),
})

export const ThreadSchema = z.strictObject({
  threadId: z.string(),
  path: RelativePathSchema.nullable(),
  line: z.number().int().nullable(),
  side: z.string().nullable(),
  resolved: z.boolean(),
  comments: z.array(ThreadCommentSchema),
})

export const PullDetailSchema = z.strictObject({
  pull: PullSchema.extend({ body: z.string().nullable(), headSha: z.string().nullable() }).nullable(),
  labels: z.array(z.strictObject({ name: z.string(), color: z.string().nullable() })),
  reviews: z.array(ReviewSchema),
  requestedReviewers: z.array(z.string()),
  comments: z.array(CommentSchema),
  commits: z.array(
    z.strictObject({
      sha: z.string(),
      message: z.string(),
      author: z.string().nullable(),
      authorLogin: z.string().nullable(),
      committedAt: UnixMillisSchema.nullable(),
    }),
  ),
  checks: z.array(
    z.strictObject({ name: z.string(), status: z.string().nullable(), url: z.url().nullable(), runId: z.number().int().nullable() }),
  ),
  threads: z.array(ThreadSchema),
})

// ---- Queries + mutation bodies ----

export const RepoParams = z.strictObject({ owner: OwnerSchema, repo: RepoNameSchema })
export const PullParams = RepoParams.extend({ number: z.coerce.number().int().positive() })

export const PullsQuerySchema = PageQuerySchema.extend({ state: z.enum(['open', 'closed']).default('open') })
export const PullFilesQuerySchema = PageQuerySchema.extend({ includePatch: z.enum(['true', 'false']).default('false') })

export const MergeMethodSchema = z.enum(['merge', 'squash', 'rebase'])
export const CreatePullSchema = z.strictObject({
  title: z.string().trim().min(1).max(1024),
  body: z.string().max(1_000_000).default(''),
  base: BranchSchema,
  head: BranchSchema,
  draft: z.boolean().default(false),
})
export const MergePullSchema = z.strictObject({ method: MergeMethodSchema })
export const PullCommentSchema = z.strictObject({ body: z.string().trim().min(1).max(1_000_000) })

export const DraftSchema = z.strictObject({ draft: z.boolean() })
export const AutoMergeSchema = z.strictObject({ method: MergeMethodSchema })
export const LabelNameSchema = z.strictObject({ name: z.string().min(1).max(200) })
export const ViewedSchema = z.strictObject({ path: RelativePathSchema, viewed: z.boolean() })
export const RequestReviewerSchema = z.strictObject({ login: z.string().min(1).max(100) })
export const ThreadResolvedSchema = z.strictObject({ resolved: z.boolean() })

export const InlineReviewCommentSchema = z.strictObject({
  body: z.string().trim().min(1).max(1_000_000),
  path: RelativePathSchema,
  line: z.number().int().positive(),
  side: z.enum(['LEFT', 'RIGHT']).default('RIGHT'),
})

export const ReviewSubmissionSchema = z
  .strictObject({ event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']), body: z.string().max(1_000_000).default('') })
  .superRefine((v, ctx) => {
    if (v.event !== 'APPROVE' && !v.body.trim()) ctx.addIssue({ code: 'custom', message: 'body is required' })
  })

export const LabelSetSchema = z.strictObject({ labels: z.array(z.strictObject({ name: z.string(), color: z.string().nullable() })) })
export const ReviewerSetSchema = z.strictObject({ reviewers: z.array(z.string()) })

// ---- Additional reads ----

export const PullPrefetchSchema = z.strictObject({
  numbers: z.array(z.number().int().positive()).min(1).max(20),
  files: z.enum(['full', 'summary', 'none']).default('summary'),
})

export const MentionsQuerySchema = z.strictObject({ query: z.string().max(100).optional() })
export const CompareQuerySchema = z.strictObject({ base: BranchSchema, head: BranchSchema })
export const PatchBatchSchema = z.strictObject({ paths: z.array(RelativePathSchema).min(1).max(100) })

export const BranchListSchema = z.strictObject({ items: z.array(z.strictObject({ name: z.string() })), nextCursor: z.string().nullable() })
export const MentionsSchema = z.strictObject({ items: z.array(z.string()) })

export const CompareSchema = z.strictObject({
  aheadBy: z.number().int().nonnegative(),
  files: z.array(z.strictObject({ path: RelativePathSchema, status: z.string().nullable(), additions: z.number().int().nullable(), deletions: z.number().int().nullable() })),
  commits: z.array(z.strictObject({ sha: z.string(), message: z.string(), author: z.string().nullable() })),
})

export const ActionJobSchema = z.strictObject({
  name: z.string(),
  status: z.string().nullable(),
  conclusion: z.string().nullable(),
  steps: z.array(z.strictObject({ name: z.string(), status: z.string().nullable(), conclusion: z.string().nullable(), number: z.number().int() })),
})
export const ActionJobsSchema = z.strictObject({ jobs: z.array(ActionJobSchema) })
export const JobLogSchema = z.strictObject({ text: z.string(), truncated: z.boolean() })
