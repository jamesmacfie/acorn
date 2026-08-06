// The github plugin's own tables (docs/vNext/data.md § Plugin DBs). They lived in
// packages/node-core/src/server/db/schema.ts until Phase 2; this is the largest single move of the
// phase, thirteen tables into <data-root>/plugins/github.sqlite.
//
// Two groups, and the distinction survives the move because it governs retention:
//
//   - **Mirror tables** (repos … checks, plus `sync_state`) are cached, revalidated projections of
//     GitHub data. Disposable by construction: GitHub is the source of truth, and anything deleted here
//     is re-fetched on the next serve-then-revalidate pass (docs/caching.md).
//   - **App-state tables** (`viewed_files`, `pinned_repos`) are data GitHub does not have, where WE are
//     the source of truth. They are github-shaped rather than github-derived — a viewed-file checkbox is
//     keyed by (repoId, PR number, path) — which is why they moved here with the mirror instead of
//     staying in core. `pinned_repos` came with them, and its route came along too: it is now
//     /v2/p/github/pins rather than /v2/core/pins (server/routes/pins.ts).
//
// The schema declares no foreign keys, exactly as core's does not. Every parent eviction therefore
// carries its inverse writes explicitly, in ONE place — server/mirrorRetention.ts. That was already the
// rule; it matters more now, because these rows can no longer be swept by a core-side cascade.
//
// `user_id` on every table is the authenticated GitHub login. It is not multi-tenancy: this is a
// single-user app. It pins the mirror to the GitHub identity, so connecting a different account does not
// inherit the previous one's cache — and for private repos it is load-bearing, because two logins may
// legitimately mirror the same repo id with different visibility.
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
    // Staleness is fetchedAt + a route constant (REPOS_STALE_AFTER_MS); list ETags live in sync_state.
    fetchedAt: integer('fetched_at').notNull(),
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
    mergeable: text('mergeable'), // MERGEABLE | CONFLICTING | UNKNOWN
    mergeStateStatus: text('merge_state_status'), // CLEAN | BLOCKED | BEHIND | DIRTY | DRAFT | UNSTABLE | UNKNOWN
    autoMergeEnabled: integer('auto_merge_enabled', { mode: 'boolean' }).notNull().default(false),
    // Staleness is fetchedAt + a route constant; the list ETag lives in sync_state (no per-row home).
    fetchedAt: integer('fetched_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.repoId, t.number] }),
    index('pull_requests_user_repo_state_updated_idx').on(t.userId, t.repoId, t.state, t.updatedAt),
  ],
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
    sha: text('sha'), // blob sha — patch bodies live in the on-disk BLOBS cache keyed by this (docs/caching.md)
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

export const prCommits = sqliteTable(
  'pr_commits',
  {
    userId: text('user_id').notNull(),
    repoId: integer('repo_id').notNull(),
    number: integer('number').notNull(),
    sha: text('sha').notNull(),
    message: text('message').notNull(),
    author: text('author'),
    authorLogin: text('author_login'),
    committedAt: integer('committed_at'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.repoId, t.number, t.sha] })],
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

// Pending review requests (logins). ponytail: users only — team review requests not mirrored.
export const reviewRequests = sqliteTable(
  'review_requests',
  {
    userId: text('user_id').notNull(),
    repoId: integer('repo_id').notNull(),
    number: integer('number').notNull(),
    login: text('login').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.repoId, t.number, t.login] })],
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
    runId: integer('run_id'), // CheckRun.checkSuite.workflowRun.databaseId — null for StatusContext; enables rerun-failed-jobs
  },
  (t) => [primaryKey({ columns: [t.userId, t.repoId, t.number, t.name] })],
)

// Collection-level revalidation bookkeeping: a list endpoint's ETag has no per-row home
// (docs/caching.md). Keyed by (userId, resource) e.g. `pulls:<repoId>:open`, `pr:<repoId>:<number>`.
//
// This table is now github's ALONE, and that is the resolution of a debt phase2-notes.md recorded as
// intent: `sync_state` used to be one core table with two unrelated key spaces sharing it — github's
// `repos` / `pulls:…` / `pr:…` / `files:…` beside the providers' `provider:<id>:<connection>:…`. Nothing
// enforced the split but convention, and a key collision between a repo id and a connection id would
// have silently crossed the two caches. The move separated them by construction: the provider markers
// stayed in core's `sync_state` (reached through `ExternalItemStore.readMarker`, which is also what
// cascade.ts evicts), and these four key shapes came here. The keys themselves are built in exactly one
// place, server/resourceKeys.ts, which moved out of core with the table.
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

// Per-user pinned repos for the selector (sort ascending). Keyed by the GitHub repo id, which is why it
// belongs to this plugin and not to core: nothing outside the github mirror can resolve that id.
export const pinnedRepos = sqliteTable(
  'pinned_repos',
  {
    userId: text('user_id').notNull(),
    repoId: integer('repo_id').notNull(),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.repoId] })],
)
