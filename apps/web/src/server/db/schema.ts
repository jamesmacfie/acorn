import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Representative slice of the read-model mirror + app-state (docs/data-layer.md).
// Two mirror tables and one app-state table prove the Drizzle → migration → local-D1
// path; the remaining tables (pr_files, comments, workflow_runs, …) land with their features.

// --- Mirror tables: cached projections of GitHub data (revalidated, disposable) ---

export const repos = sqliteTable(
  'repos',
  {
    // Private repos are user-scoped (docs/data-layer.md): two users may mirror the same
    // private repo, so (userId, id) is the key — id alone (the GitHub repo id) isn't unique.
    userId: text('user_id').notNull(),
    id: integer('id').notNull(), // GitHub repo id
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    private: integer('private', { mode: 'boolean' }).notNull().default(false),
    defaultBranch: text('default_branch'),
    pushedAt: integer('pushed_at'), // epoch ms — repo selector orders by this
    // staleness: row is stale when now > fetchedAt + staleAfter; etag drives revalidation
    fetchedAt: integer('fetched_at').notNull(),
    staleAfter: integer('stale_after').notNull(),
    etag: text('etag'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
)

export const pullRequests = sqliteTable(
  'pull_requests',
  {
    // User-scoped like repos: a private repo's PR mirror must never serve across users.
    userId: text('user_id').notNull(),
    repoId: integer('repo_id').notNull(),
    number: integer('number').notNull(),
    nodeId: text('node_id'), // GraphQL node id — needed for draft↔ready toggles
    state: text('state').notNull(), // open | closed | merged
    draft: integer('draft', { mode: 'boolean' }).notNull().default(false),
    title: text('title').notNull(),
    body: text('body'), // sanitized bodyHTML from GraphQL (rendered via innerHTML)
    headSha: text('head_sha'), // head commit oid — commit_id for creating line comments
    headRef: text('head_ref'),
    baseRef: text('base_ref'),
    author: text('author'),
    updatedAt: integer('updated_at'),
    fetchedAt: integer('fetched_at').notNull(),
    staleAfter: integer('stale_after').notNull(),
    etag: text('etag'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.repoId, t.number] })],
)

// --- PR-detail children: mirrored together from the GraphQL composite, replaced wholesale on
// each sync. No per-row staleness — freshness is governed by sync_state(`pr:<repoId>:<number>`).
// All user-scoped and keyed off the PR (userId, repoId, number) + a per-row discriminator.

export const prFiles = sqliteTable(
  'pr_files',
  {
    userId: text('user_id').notNull(),
    repoId: integer('repo_id').notNull(),
    number: integer('number').notNull(),
    path: text('path').notNull(),
    status: text('status'), // changeType / GitHub status: added | modified | removed | renamed | …
    additions: integer('additions'),
    deletions: integer('deletions'),
    sha: text('sha'), // blob sha — immutability key for the patch (docs/caching.md)
    patch: text('patch'), // private-repo patch body; public bodies live in KV by sha, this stays null
  },
  (t) => [primaryKey({ columns: [t.userId, t.repoId, t.number, t.path] })],
)

export const reviews = sqliteTable(
  'reviews',
  {
    userId: text('user_id').notNull(),
    repoId: integer('repo_id').notNull(),
    number: integer('number').notNull(),
    id: text('id').notNull(), // GraphQL node id
    author: text('author'),
    state: text('state'), // APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED | PENDING
    body: text('body'),
    submittedAt: integer('submitted_at'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.repoId, t.number, t.id] })],
)

export const comments = sqliteTable(
  'comments',
  {
    userId: text('user_id').notNull(),
    repoId: integer('repo_id').notNull(),
    number: integer('number').notNull(),
    id: text('id').notNull(), // GraphQL node id
    author: text('author'),
    body: text('body'),
    createdAt: integer('created_at'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.repoId, t.number, t.id] })],
)

// Inline review-comment threads. One row per comment; thread-level fields (path/line/side/
// resolved) are denormalized onto each row. databaseId is the numeric id REST needs for replies.
export const reviewThreads = sqliteTable(
  'review_threads',
  {
    userId: text('user_id').notNull(),
    repoId: integer('repo_id').notNull(),
    number: integer('number').notNull(),
    threadId: text('thread_id').notNull(),
    id: text('id').notNull(), // comment node id
    databaseId: integer('database_id'),
    path: text('path'),
    line: integer('line'),
    side: text('side'), // RIGHT | LEFT
    resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
    author: text('author'),
    body: text('body'),
    createdAt: integer('created_at'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.repoId, t.number, t.id] })],
)

export const prLabels = sqliteTable(
  'pr_labels',
  {
    userId: text('user_id').notNull(),
    repoId: integer('repo_id').notNull(),
    number: integer('number').notNull(),
    name: text('name').notNull(),
    color: text('color'), // 6-hex, no leading #
  },
  (t) => [primaryKey({ columns: [t.userId, t.repoId, t.number, t.name] })],
)

export const checks = sqliteTable(
  'checks',
  {
    userId: text('user_id').notNull(),
    repoId: integer('repo_id').notNull(),
    number: integer('number').notNull(),
    name: text('name').notNull(), // CheckRun.name | StatusContext.context
    status: text('status'), // CheckRun.conclusion|status | StatusContext.state
    url: text('url'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.repoId, t.number, t.name] })],
)

// Collection-level revalidation bookkeeping: a list endpoint's ETag has no per-row home
// (docs/caching.md). Keyed by (userId, resource) e.g. `pulls:<repoId>:open`, `pr:<repoId>:<number>`.
export const syncState = sqliteTable(
  'sync_state',
  {
    userId: text('user_id').notNull(),
    resource: text('resource').notNull(),
    etag: text('etag'),
    fetchedAt: integer('fetched_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.resource] })],
)

// --- App-state tables: data GitHub doesn't have, we are the source of truth ---

// Per-user "I've reviewed this file" checkboxes. Survives mirror re-syncs (not a GitHub concept).
export const viewedFiles = sqliteTable(
  'viewed_files',
  {
    userId: text('user_id').notNull(),
    repoId: integer('repo_id').notNull(),
    number: integer('number').notNull(),
    path: text('path').notNull(),
    viewedAt: integer('viewed_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.repoId, t.number, t.path] })],
)

// Per-user pinned repos for the selector (sort ascending).
export const pinnedRepos = sqliteTable(
  'pinned_repos',
  {
    userId: text('user_id').notNull(),
    repoId: integer('repo_id').notNull(),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.repoId] })],
)

export const prefs = sqliteTable(
  'prefs',
  {
    userId: text('user_id').notNull(),
    key: text('key').notNull(), // theme, diff view mode, keybinding overrides, …
    value: text('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
)
