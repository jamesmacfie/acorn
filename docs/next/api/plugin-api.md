# Plugin-owned APIs

## 1. Ownership model

Core owns the public listener, bearer principal, scope gate, validation, envelopes, OpenAPI,
idempotency, request ids, and registry lifecycle. A plugin owns the meaning and implementation of
its resources.

Public plugin paths are always:

```text
/api/v1/plugins/<plugin-id>/<plugin-owned-path>
```

Core paths such as `/tasks`, `/workspaces`, `/commands`, `/integrations`, and `/ui` are reserved.
Plugins cannot mount outside their namespace, shadow another plugin, add anonymous endpoints, or
replace middleware.

The current `RouteRegistry` accepts arbitrary Hono routers under `/api`; keep it for internal UI
compatibility. The public registry accepts schema-first endpoint contributions only.

## 2. Endpoint contribution contract

```ts
type ApiInput<P, Q, H, B> = {
  params: P
  query: Q
  headers: H
  body: B
}

type PluginApiEndpoint<P, Q, H, B, O> = {
  pluginId: string
  operationId: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: `/${string}`                // relative to /plugins/<pluginId>
  scope: 'read' | 'write'
  risk: 'read' | 'write' | 'execute'
  summary: string
  description?: string
  params?: z.ZodType<P>
  query?: z.ZodType<Q>
  headers?: z.ZodType<H>
  body?: z.ZodType<B>
  response: z.ZodType<O>
  status?: 200 | 201 | 202 | 204
  idempotency?: 'required' | 'optional' | 'forbidden'
  bodyLimitBytes?: number
  handler(ctx: PluginApiContext, input: ApiInput<P, Q, H, B>): Promise<O | NoContent>
}

type PluginApiContribution = {
  pluginId: string
  endpoints: readonly PluginApiEndpoint<any, any, any, any, any>[]
  events?: readonly PluginEventContribution<any>[]
  commands?: readonly CommandContribution<any, any>[]
}
```

`PluginApiContext` exposes the resolved principal, request id/signal, operation actor, event
publisher, and plugin-declared service dependencies. It does not expose raw token text, session
cookies, the unrestricted Hono context, or another plugin's internals.

Example:

```ts
export const changesPublicApi: PluginApiContribution = definePluginApi({
  pluginId: 'changes',
  endpoints: [
    defineEndpoint({
      operationId: 'changes.git.commit',
      method: 'POST',
      path: '/tasks/:taskId/git/commit',
      scope: 'write',
      risk: 'execute',
      params: z.strictObject({ taskId: IdSchema }),
      body: CommitSchema,
      response: CommitResultSchema,
      handler: (ctx, { params, body }) => ctx.services.git.commit(ctx.operation, params.taskId, body),
    }),
  ],
})
```

## 3. Registry invariants and conformance

At activation/freeze, core rejects:

- a plugin id that does not match the activation owner;
- non-lowercase ids outside `[a-z][a-z0-9-]{0,63}`;
- paths containing `..`, `//`, wildcards, a version segment, or another plugin prefix;
- duplicate `(method,path)` or `operationId` values;
- an endpoint without explicit scope/risk/response schema;
- mutating/execute-risk endpoints declared with `read` scope;
- body schemas on `GET`/`DELETE` or missing body schemas on body-bearing methods;
- `.passthrough()`/unknown-preserving public object schemas (enforced by schema metadata/helper);
- commands/events with a different plugin prefix.

The shared conformance suite enumerates every endpoint and verifies authentication, read/write scope,
unknown-key rejection, invalid params/query/body, standard envelopes, response validation, OpenAPI
presence, and log redaction. Plugin-specific tests verify behavior.

## 4. Shared GitHub response schemas

The GitHub plugin must turn the existing interfaces in `core/shared/api.ts` into strict Zod schemas
and infer the types from them. The public API returns Acorn's stable projection, never raw GitHub
payloads.

```ts
const RepoSchema = z.strictObject({
  id: z.number().int().positive(), owner: OwnerSchema, name: RepoNameSchema,
  private: z.boolean(), defaultBranch: z.string().nullable(), pushedAt: UnixMillisSchema.nullable(),
})
const PullSchema = z.strictObject({
  number: z.number().int().positive(), title: z.string(), state: z.string(), draft: z.boolean(),
  author: z.string().nullable(), headRef: z.string().nullable(), baseRef: z.string().nullable(),
  updatedAt: UnixMillisSchema.nullable(), mergeable: z.string().nullable(),
  mergeStateStatus: z.string().nullable(), autoMergeEnabled: z.boolean(),
})
const PullFileSchema = z.strictObject({
  path: RelativePathSchema, status: z.string().nullable(), additions: z.number().int().nullable(),
  deletions: z.number().int().nullable(), sha: z.string().nullable(), viewed: z.boolean(),
  patch: z.string().nullable(),
})
const ReviewSchema = z.strictObject({
  id: z.string(), author: z.string().nullable(), state: z.string().nullable(),
  body: z.string().nullable(), submittedAt: UnixMillisSchema.nullable(),
})
const CommentSchema = z.strictObject({
  id: z.string(), author: z.string().nullable(), body: z.string().nullable(),
  createdAt: UnixMillisSchema.nullable(),
})
const ThreadCommentSchema = z.strictObject({
  id: z.string(), databaseId: z.number().int().nullable(), author: z.string().nullable(),
  body: z.string().nullable(), createdAt: UnixMillisSchema.nullable(),
})
const ThreadSchema = z.strictObject({
  threadId: z.string(), path: RelativePathSchema.nullable(), line: z.number().int().nullable(),
  side: z.string().nullable(), resolved: z.boolean(), comments: z.array(ThreadCommentSchema),
})
const PullDetailSchema = z.strictObject({
  pull: PullSchema.extend({ body: z.string().nullable(), headSha: z.string().nullable() }).nullable(),
  labels: z.array(z.strictObject({ name: z.string(), color: z.string().nullable() })),
  reviews: z.array(ReviewSchema),
  requestedReviewers: z.array(z.string()),
  comments: z.array(CommentSchema),
  commits: z.array(z.strictObject({
    sha: z.string(), message: z.string(), author: z.string().nullable(),
    authorLogin: z.string().nullable(), committedAt: UnixMillisSchema.nullable(),
  })),
  checks: z.array(z.strictObject({
    name: z.string(), status: z.string().nullable(), url: z.url().nullable(), runId: z.number().int().nullable(),
  })),
  threads: z.array(ThreadSchema),
})
```

## 5. GitHub plugin endpoint catalog

Base: `/plugins/github`.

### Repository and pull reads

| Method | Path | Scope | Input | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/repos` | `read` | page + `refresh=false` | page of `Repo` |
| `POST` | `/repos/refresh` | `write` | no body | bounded refreshed repos |
| `GET` | `/repos/:owner/:repo/labels` | `read` | — | `{ items: Label[] }` |
| `GET` | `/repos/:owner/:repo/mentions` | `read` | optional `query` | bounded login suggestions |
| `GET` | `/repos/:owner/:repo/branches` | `read` | page/filter | page of `{ name }` |
| `GET` | `/repos/:owner/:repo/compare` | `read` | `base`, `head` | `{ aheadBy, files, commits }` |
| `GET` | `/repos/:owner/:repo/pulls` | `read` | page + `state=open` or `closed` | page of `Pull` |
| `GET` | `/repos/:owner/:repo/pulls/:number` | `read` | `refresh=false` | `PullDetail` |
| `GET` | `/repos/:owner/:repo/pulls/:number/files` | `read` | page + `includePatch=false` | page of `PullFile` |
| `POST` | `/repos/:owner/:repo/pulls/:number/files/batch` | `read` | `{ paths: RelativePath[1..100] }` | bounded `PullFile[]` |
| `GET` | `/repos/:owner/:repo/blobs/:sha` | `read` | — | `{ text }`, max 5 MiB |
| `POST` | `/repos/:owner/:repo/pulls/prefetch` | `read` | batch schema below | warmed pull items |
| `GET` | `/repos/:owner/:repo/actions/runs/:runId/jobs` | `read` | — | jobs + steps |
| `GET` | `/repos/:owner/:repo/actions/jobs/:jobId/log` | `read` | — | bounded `{ text, truncated }` |

```ts
const PullPrefetchSchema = z.strictObject({
  numbers: z.array(z.number().int().positive()).min(1).max(20),
  files: z.enum(['full', 'summary', 'none']).default('summary'),
})
const CompareQuerySchema = z.strictObject({ base: BranchSchema, head: BranchSchema })
const PatchBatchSchema = z.strictObject({ paths: z.array(RelativePathSchema).min(1).max(100) })
```

`POST /repos/refresh` changes the local mirror and consumes upstream quota, so it is write-scoped
even though the upstream operation is a read. Ordinary stale-while-revalidate reads remain
read-scoped.

### Pull and Actions mutations

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| `POST` | `/repos/:owner/:repo/pulls` | `CreatePull` | `201 { number }` |
| `POST` | `/repos/:owner/:repo/pulls/:number/merge` | `{ method }` | `{ state: 'merged' }` |
| `PUT` | `/repos/:owner/:repo/pulls/:number/auto-merge` | `{ method }` | `{ autoMergeEnabled: true }` |
| `DELETE` | `/repos/:owner/:repo/pulls/:number/auto-merge` | — | `204` |
| `POST` | `/repos/:owner/:repo/pulls/:number/close` | no body | `{ state: 'closed' }` |
| `POST` | `/repos/:owner/:repo/pulls/:number/reopen` | no body | `{ state: 'open' }` |
| `PUT` | `/repos/:owner/:repo/pulls/:number/draft` | `{ draft }` | `{ draft }` |
| `POST` | `/repos/:owner/:repo/pulls/:number/comments` | `{ body }` | `201 Comment` |
| `POST` | `/repos/:owner/:repo/pulls/:number/labels` | `{ name }` | complete label set |
| `DELETE` | `/repos/:owner/:repo/pulls/:number/labels/:name` | — | complete label set |
| `PUT` | `/repos/:owner/:repo/pulls/:number/files/viewed` | `{ path, viewed }` | `{ path, viewed }` |
| `POST` | `/repos/:owner/:repo/pulls/:number/review-comments` | inline comment | `201 { created: true }` |
| `POST` | `/repos/:owner/:repo/pulls/:number/review-comments/:commentId/replies` | `{ body }` | `201 { created: true }` |
| `PUT` | `/repos/:owner/:repo/pulls/:number/threads/:threadId/resolved` | `{ resolved }` | `{ resolved }` |
| `POST` | `/repos/:owner/:repo/pulls/:number/reviews` | review submission | `201 { submitted: true }` |
| `POST` | `/repos/:owner/:repo/pulls/:number/requested-reviewers` | `{ login }` | complete reviewer list |
| `DELETE` | `/repos/:owner/:repo/pulls/:number/requested-reviewers/:login` | — | complete reviewer list |
| `POST` | `/repos/:owner/:repo/actions/runs/:runId/rerun-failed` | no body | `{ accepted: true }` |

All require `write`. Create/comment/reply/review/merge/auto-merge require `Idempotency-Key`.

```ts
const MergeMethodSchema = z.enum(['merge', 'squash', 'rebase'])
const CreatePullSchema = z.strictObject({
  title: z.string().trim().min(1).max(1024), body: z.string().max(1_000_000).default(''),
  base: BranchSchema, head: BranchSchema, draft: z.boolean().default(false),
})
const BodySchema = z.strictObject({ body: z.string().trim().min(1).max(1_000_000) })
const InlineReviewCommentSchema = BodySchema.extend({
  path: RelativePathSchema, line: z.number().int().positive(), side: z.enum(['LEFT', 'RIGHT']).default('RIGHT'),
})
const ReviewSubmissionSchema = z.strictObject({
  event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']),
  body: z.string().max(1_000_000).default(''),
}).superRefine((v, ctx) => {
  if (v.event !== 'APPROVE' && !v.body.trim()) ctx.addIssue({ code: 'custom', message: 'body is required' })
})
```

## 6. Integration connection lifecycle

Connections are core resources because core encrypts credentials and provider plugins only validate
and use them.

| Method | Core path | Scope | Body | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/integrations` | `read` | — | provider catalog + safe connection summaries |
| `POST` | `/integrations` | `write` | connect request; idempotency required | `201 Integration` |
| `PUT` | `/integrations/:connectionId/credentials` | `write` | complete credential map | updated summary |
| `POST` | `/integrations/:connectionId/test` | `write` | no body | updated summary |
| `PATCH` | `/integrations/:connectionId` | `write` | `{ disabled }` | updated summary |
| `DELETE` | `/integrations/:connectionId` | `write` | — | `204` + existing cascade |

```ts
const ConnectIntegrationSchema = z.strictObject({
  providerId: z.string().min(1).max(100),
  credentials: z.record(z.string().min(1).max(100), z.string().max(100_000)),
})
const IntegrationSummarySchema = z.strictObject({
  id: z.string(), providerId: z.string(), label: z.string(),
  status: z.enum(['connected', 'needs-auth', 'degraded', 'disabled']),
  authKind: z.enum(['github-session', 'api-key', 'oauth', 'installation', 'none']),
  account: z.strictObject({ id: z.string(), label: z.string(), type: z.string().optional() }).nullable(),
  scopes: z.array(z.string()),
  capabilities: z.record(z.string(), z.enum(['available', 'missing-scope', 'degraded'])),
  createdAt: UnixMillisSchema, updatedAt: UnixMillisSchema,
  lastValidatedAt: UnixMillisSchema.optional(), lastError: z.string().optional(),
})
```

Credentials are write-only and never appear in responses, discovery, errors, events, or logs.

## 7. Linear and Rollbar provider endpoints

### Linear base `/plugins/linear`

| Method | Path | Scope | Input | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/projects` | `read` | `connectionId?` | bounded projects |
| `GET` | `/projects/:projectId/issues` | `read` | required `connectionId`, page | page of issue summaries |
| `POST` | `/issues/resolve` | `read` | identifiers + optional connection | summaries |
| `GET` | `/issues/:identifier` | `read` | `connectionId`, `refresh=false` | issue detail/comments/activity |
| `POST` | `/issues/:identifier/comments` | `write` | `connectionId`, `{ body, parentId? }`; idempotency required | `201 comment` |

```ts
const LinearStateSchema = z.strictObject({ name: z.string(), type: z.string(), color: z.string() }).nullable()
const LinearIssueSummarySchema = z.strictObject({
  identifier: z.string(), title: z.string(), url: z.url(), state: LinearStateSchema,
  assignee: z.string().nullable(),
})
const ResolveLinearIssuesSchema = z.strictObject({
  connectionId: IdSchema.optional(), identifiers: z.array(z.string().min(1)).min(1).max(100),
})
const LinearCommentSchema = z.strictObject({
  body: z.string().trim().min(1).max(1_000_000), parentId: z.string().optional(),
})
```

### Rollbar base `/plugins/rollbar`

| Method | Path | Scope | Input | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/items` | `read` | `connectionId?`, page, status filters | page of items |
| `GET` | `/items/:identifier` | `read` | required `connectionId`, `refresh=false` | item detail |

```ts
const RollbarItemSchema = z.strictObject({
  integrationId: IdSchema, identifier: z.string(), title: z.string(), level: z.string(),
  environment: z.string(), status: z.string(), totalOccurrences: z.number().int().nonnegative(),
  firstOccurrenceAt: UnixMillisSchema.nullable(), lastOccurrenceAt: UnixMillisSchema.nullable(),
})
```

The shipped Rollbar pane has no write action, so no Rollbar mutation is invented for `v1`.

## 8. Changes review-note endpoints

Base: `/plugins/changes/tasks/:taskId/review-notes`.

```ts
const ReviewNoteSchema = z.strictObject({
  id: IdSchema, taskId: IdSchema, path: RelativePathSchema,
  side: z.enum(['additions', 'deletions']), startLine: z.number().int().positive(),
  endLine: z.number().int().positive(), snippet: z.string().nullable(), body: z.string(),
  sentAt: UnixMillisSchema.nullable(), createdAt: UnixMillisSchema,
}).refine((v) => v.endLine >= v.startLine)
const CreateReviewNoteSchema = ReviewNoteSchema.pick({
  path: true, side: true, startLine: true, endLine: true, snippet: true, body: true,
}).extend({ snippet: z.string().nullable().optional() })
```

| Method | Relative path | Scope | Body | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/` | `read` | — | bounded notes |
| `POST` | `/` | `write` | create schema; idempotency required | `201 ReviewNote` |
| `PATCH` | `/:noteId` | `write` | `{ body: nonempty }` | updated note, `sentAt=null` |
| `DELETE` | `/:noteId` | `write` | — | `204` |
| `POST` | `/mark-sent` | `write` | `{ ids: uuid[1..1000] }` | updated notes/count |

## 9. Context endpoint

Base: `/plugins/context/tasks/:taskId`.

| Method | Path | Scope | Input | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/repo-info` | `read` | — | owner/name/defaultBranch/branch/worktreePath |
| `GET` | `/context` | `read` | `include=*` or comma-separated registered section ids | assembled strict `TaskContext` |

Convert `TaskContext`, `ContextSectionResult`, `ContextItem`, budgets, pane intents, notes, issues,
and memory projections from `core/shared/api.ts` into strict schemas. `workflowRunId` remains an
internal-only parameter and is not accepted publicly.

## 10. Notes and memory

### Notes base `/plugins/notes`

Use separate paths rather than a magic `global` workspace id:

```text
/global/notes
/workspaces/:workspaceId/notes
/tasks/:taskId/notes
```

Each collection supports `GET` (bounded list) and `POST { title, kind? }` (`201`, idempotency).
Each `/:slug` supports `GET`, `PUT { body, expectedVersion? }`, and `DELETE`. Each
`/:slug/included` supports `PUT { included }`.

```ts
const NoteSummarySchema = z.strictObject({
  slug: z.string(), title: z.string(), kind: z.string(), included: z.boolean(),
  updatedAt: UnixMillisSchema, version: z.string(),
})
const NoteSchema = NoteSummarySchema.extend({ body: z.string() })
const CreateNoteSchema = z.strictObject({
  title: z.string().trim().min(1).max(240), kind: z.string().min(1).max(100).optional(),
})
```

### Memory base `/plugins/memory`

| Method | Path | Scope | Body/query | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/entries` | `read` | page + `repo?`, `type?` | memory summaries |
| `POST` | `/search` | `read` | `{ query, repo?, type?, limit }` | bounded ranked entries |
| `POST` | `/tasks/:taskId/entries` | `write` | memory input; idempotency required | `201 entry` |
| `GET` | `/proposals` | `read` | `taskId?`, page | proposals |
| `POST` | `/proposals/:proposalId/resolve` | `write` | approval/edit schema | resolved result |

```ts
const MemoryInputSchema = z.strictObject({
  scope: z.enum(['repo', 'private']), name: z.string().trim().min(1).max(240),
  description: z.string().max(10_000), type: z.string().min(1).max(100),
  body: z.string().max(1_000_000),
})
const ResolveProposalSchema = z.discriminatedUnion('approved', [
  z.strictObject({ approved: z.literal(false) }),
  z.strictObject({ approved: z.literal(true), edited: MemoryInputSchema.omit({ scope: true }).optional() }),
])
```

## 11. Workflows

Base: `/plugins/workflows`.

| Method | Path | Scope | Body | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/tasks/:taskId/definitions` | `read` | — | validated definitions + named parse errors |
| `POST` | `/tasks/:taskId/runs` | `write` | `{ definitionId, posture? }`; idempotency required | `202 run` |
| `GET` | `/tasks/:taskId/runs` | `read` | page + status | page of runs |
| `GET` | `/runs/:runId` | `read` | — | run |
| `GET` | `/runs/:runId/steps` | `read` | page | steps |
| `POST` | `/runs/:runId/gates/:stepId/resolve` | `write` | `{ approved }` | updated step/run |
| `POST` | `/runs/:runId/cancel` | `write` | no body | updated run |
| `POST` | `/runs/:runId/steps/:stepId/kill` | `write` | no body | updated step |
| `POST` | `/triggers/evaluate` | `write` | no body | bounded started/skipped trigger results |

The existing internal route accepts the whole workflow definition to start. The public contract uses
the registered `definitionId`, so callers cannot bypass file validation/trust by submitting a new
executable graph. If ad-hoc workflows are desired later, design a separate explicitly execute-risk
endpoint.

Trigger evaluation is write-scoped because a matching predicate can start a workflow. It reuses the
registered trigger poller service and idempotent run checks; it is not a second trigger engine.

Workflow run/step schemas mirror the durable table fields but parse `defJson`, `resultJson`, and
`structuredJson` into typed JSON values; never return raw JSON strings. Stream step events through
the public WebSocket.

## 12. Preview

Base: `/plugins/preview/tasks/:taskId`.

| Method | Path | Scope | Body | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/configuration` | `read` | — | resolved mode/value and current URL |
| `POST` | `/resolve-url` | `write` | no body | `{ url }`; execute-risk when script-backed |
| `PUT` | `/url` | `write` | `{ url: http(s) URL }` | current URL |
| `POST` | `/navigation` | `write` | `{ action: back, forward, reload, or stop }` | navigation state |
| `DELETE` | `/view` | `write` | — | `204`, evict task preview view |

These handlers target the preview service by task id. They never accept/return a raw
`webContents` id, CDP handle, bounds, or arbitrary Electron window id. Bounds/show/hide remain
renderer-owned presentation behavior; use the preview pane command to show it.

## 13. Database

Base: `/plugins/database/tasks/:taskId`.

```ts
const DbCellSchema = z.string().nullable()
const DbPkSchema = z.record(z.string().min(1).max(128), DbCellSchema)
const DbResultSetSchema = z.strictObject({
  columns: z.array(z.string()).max(1000), rows: z.array(z.array(DbCellSchema)).max(10_000),
  rowCount: z.number().int().nullable(), command: z.string(),
})
```

| Method | Path | Scope | Body/query | Response |
| --- | --- | --- | --- | --- |
| `POST` | `/connection` | `write` | no body | `{ database }` (never URL) |
| `DELETE` | `/connection` | `write` | — | `204` |
| `GET` | `/tables` | `read` | — | bounded `{ schema, name }[]` |
| `GET` | `/tables/:schema/:name/columns` | `read` | — | columns |
| `GET` | `/tables/:schema/:name/rows` | `read` | `limit<=500,cursor` | result page |
| `POST` | `/query` | `write` | `{ sql: nonempty <=1MiB }` | result + duration |
| `POST` | `/tables/:schema/:name/rows` | `write` | `{ values: record<DbCell> }` | row count |
| `PATCH` | `/tables/:schema/:name/rows` | `write` | `{ column, value, pk }` | row count |
| `POST` | `/tables/:schema/:name/rows/delete` | `write` | `{ pk }` | row count |

SQL query is `write` even for a textual `SELECT`: determining read-only SQL correctly across
Postgres syntax is not a security boundary. Generated update/insert/delete validates identifiers
against the live schema and parameterizes values. The connection URL remains resolved server-side,
unpersisted, and absent from responses/logs.

## 14. Plugins with no public endpoints

- `agents` uses terminal sessions, workflows, events, and UI commands rather than duplicating them.
- `profiles-claude`, `profiles-codex`, and `profiles-aider` contribute terminal profiles.
- `onboarding` is presentation over core workspace/repository APIs.
- `search` is part of the editor plugin API.

A plugin is not required to expose an endpoint. It may contribute only commands/events/profiles or
pure UI.
