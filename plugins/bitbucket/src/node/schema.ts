import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// The mirror: cached projections of Bitbucket data, revalidated and disposable. Every table is scoped by
// the connection, so a person who reconnects as another account never reads the first account's
// private repositories.
//
// A repository is keyed by its full name lowercased, `workspace/repo`, which is how core stores it. A
// pull request's child rows are replaced together on each refresh, and `sync_state` says when. Each
// child table has a `position`, its place in the order Bitbucket returned it, and reads order by it.

export const repositories = sqliteTable(
  'repositories',
  {
    connectionId: text('connection_id').notNull(),
    repo: text('repo').notNull(), // full_name lowercased
    path: text('path').notNull(), // full_name as Bitbucket spells it
    name: text('name').notNull(),
    defaultBranch: text('default_branch'),
    private: integer('private', { mode: 'boolean' }).notNull().default(true),
    updatedAt: integer('updated_at'), // epoch ms, the importer's order
    fetchedAt: integer('fetched_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.repo] })],
)

export const pullRequests = sqliteTable(
  'pull_requests',
  {
    connectionId: text('connection_id').notNull(),
    repo: text('repo').notNull(),
    number: integer('number').notNull(),
    state: text('state').notNull(), // open | closed | merged
    draft: integer('draft', { mode: 'boolean' }).notNull().default(false),
    title: text('title').notNull(),
    body: text('body'), // summary.html; the client sanitizes it
    headRef: text('head_ref'),
    baseRef: text('base_ref'),
    // The head's whole hash once the detail has read the commit list. The pull request itself, and so
    // the base, name commits by a short hash.
    headSha: text('head_sha'),
    baseSha: text('base_sha'),
    // A fork's full name lowercased, or null when the source branch is in this repository.
    sourceRepo: text('source_repo'),
    author: text('author'),
    authorAvatar: text('author_avatar'),
    updatedAt: integer('updated_at'),
    // The file list stopped at the mirror's page budget, so Bitbucket may hold more.
    filesCapped: integer('files_capped', { mode: 'boolean' }).notNull().default(false),
    fetchedAt: integer('fetched_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.connectionId, t.repo, t.number] }),
    index('pull_requests_connection_repo_state_updated_idx').on(t.connectionId, t.repo, t.state, t.updatedAt),
  ],
)

export const prFiles = sqliteTable(
  'pr_files',
  {
    connectionId: text('connection_id').notNull(),
    repo: text('repo').notNull(),
    number: integer('number').notNull(),
    path: text('path').notNull(),
    status: text('status'), // added | modified | removed | renamed
    additions: integer('additions'),
    deletions: integer('deletions'),
    position: integer('position').notNull(),
    // 'available': patch_key names the patch body in the blob cache. 'unavailable': the diff had no
    // text for it (binary, or a pure rename).
    patchState: text('patch_state').notNull(),
    patchKey: text('patch_key'),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.repo, t.number, t.path] })],
)

// Everyone on a pull request: the reviewers asked, and anyone else who approved, asked for changes, or
// commented. The verdict and its time are each person's latest.
export const participants = sqliteTable(
  'participants',
  {
    connectionId: text('connection_id').notNull(),
    repo: text('repo').notNull(),
    number: integer('number').notNull(),
    login: text('login').notNull(), // the account's nickname
    uuid: text('uuid').notNull(), // what a reviewer is addressed by when the list is written
    avatarUrl: text('avatar_url'),
    reviewer: integer('reviewer', { mode: 'boolean' }).notNull().default(false),
    state: text('state'), // approved | changes-requested | null
    at: integer('at'), // participated_on, epoch ms
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.repo, t.number, t.login] })],
)

// Every comment that isn't deleted or a pending draft. A reply carries its thread's root id, which is
// the id the diff addresses the thread by and the comment that holds its resolution.
export const comments = sqliteTable(
  'comments',
  {
    connectionId: text('connection_id').notNull(),
    repo: text('repo').notNull(),
    number: integer('number').notNull(),
    id: integer('id').notNull(),
    threadId: integer('thread_id').notNull(),
    onDiff: integer('on_diff', { mode: 'boolean' }).notNull().default(false),
    path: text('path'),
    line: integer('line'),
    side: text('side'), // old | new
    outdated: integer('outdated', { mode: 'boolean' }).notNull().default(false),
    resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
    author: text('author'),
    authorAvatar: text('author_avatar'),
    authorIsBot: integer('author_is_bot', { mode: 'boolean' }).notNull().default(false),
    body: text('body'), // content.html
    createdAt: integer('created_at'),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.repo, t.number, t.id] })],
)

export const commits = sqliteTable(
  'commits',
  {
    connectionId: text('connection_id').notNull(),
    repo: text('repo').notNull(),
    number: integer('number').notNull(),
    sha: text('sha').notNull(),
    message: text('message').notNull(),
    author: text('author'),
    authorLogin: text('author_login'),
    committedAt: integer('committed_at'),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.repo, t.number, t.sha] })],
)

// Build statuses on the pull request's commits, its checks. Only those on the head commit are drawn.
export const statuses = sqliteTable(
  'statuses',
  {
    connectionId: text('connection_id').notNull(),
    repo: text('repo').notNull(),
    number: integer('number').notNull(),
    key: text('key').notNull(),
    commitSha: text('commit_sha').notNull(),
    name: text('name').notNull(),
    status: text('status'), // in the check vocabulary, such as `failure` or `in_progress`
    url: text('url'),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.repo, t.number, t.key, t.commitSha] })],
)

export const syncState = sqliteTable(
  'sync_state',
  {
    connectionId: text('connection_id').notNull(),
    resource: text('resource').notNull(),
    // A files resource's `<base sha>:<head sha>`, which its diff is cut against.
    revision: text('revision'),
    fetchedAt: integer('fetched_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.connectionId, t.resource] })],
)
