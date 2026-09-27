import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// --- Mirror tables: cached projections of GitHub data (revalidated, disposable) ---

export const repos = sqliteTable(
  'repos',
  {
    // Private repos are user-scoped (docs/data-layer.md): two users may mirror the same
    // private repo, so (userId, id) is the key. Id alone (the GitHub repo id) isn't unique.
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
    body: text('body'), // provider-rendered bodyHTML; the client sanitizes it before display
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
// each sync. No per-row staleness; freshness is governed by sync_state(`pr:<repoId>:<number>`).
// All user-scoped and keyed off the PR (userId, repoId, number) + a per-row discriminator.
//
// Every child table has a `position`: the row's zero-based place in the order GitHub returned it,
// counted per PR. Reads order by it, never by SQLite's insertion order. What it counts is stated on
// each table, because the connections differ.

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
    sha: text('sha'), // new-side blob sha, for whole-file context; not the patch's identity
    position: integer('position').notNull(), // place in the REST files list, across every page
    // 'available' | 'unavailable'. Available means patch_key names a body in the BLOBS cache;
    // unavailable means GitHub sent no patch (binary, too large, a pure rename).
    patchState: text('patch_state').notNull(),
    patchKey: text('patch_key'), // 'sha256:<hex>' of the patch text (docs/caching.md)
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
    position: integer('position').notNull(), // place in the reviews connection
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
    position: integer('position').notNull(), // place in the issue comments connection
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
    position: integer('position').notNull(), // place in the commits connection
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
    // Across every comment of every thread: threads in connection order, then each thread's comments
    // in theirs. One ordering recovers both the thread order and the order within a thread.
    position: integer('position').notNull(),
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
    position: integer('position').notNull(), // place in the labels connection
  },
  (t) => [primaryKey({ columns: [t.userId, t.repoId, t.number, t.name] })],
)

export const reviewRequests = sqliteTable(
  'review_requests',
  {
    userId: text('user_id').notNull(),
    repoId: integer('repo_id').notNull(),
    number: integer('number').notNull(),
    login: text('login').notNull(),
    position: integer('position').notNull(), // place in the review requests connection, users only
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
    // Place in the latest commit's contexts connection, after duplicate names keep their last entry.
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.repoId, t.number, t.name] })],
)

export const syncState = sqliteTable(
  'sync_state',
  {
    userId: text('user_id').notNull(),
    resource: text('resource').notNull(),
    etag: text('etag'),
    fetchedAt: integer('fetched_at').notNull(),
    // Only a pull's files resource (`files:<repoId>:<number>`) sets these, and only when GitHub's
    // 3,000-file ceiling cut the list short. All null means the resource is complete. They change in
    // the same batch as the rows and fetched_at, so a failed refresh leaves the old values.
    incompleteCause: text('incomplete_cause'), // 'upstream-cap'
    received: integer('received'),
    reportedTotal: integer('reported_total'), // null when GitHub gave no count
    upstreamLimit: integer('upstream_limit'),
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
