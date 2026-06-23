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
    repoId: integer('repo_id').notNull(),
    number: integer('number').notNull(),
    nodeId: text('node_id'), // GraphQL node id — needed for draft↔ready toggles
    state: text('state').notNull(), // open | closed | merged
    draft: integer('draft', { mode: 'boolean' }).notNull().default(false),
    title: text('title').notNull(),
    headRef: text('head_ref'),
    baseRef: text('base_ref'),
    author: text('author'),
    updatedAt: integer('updated_at'),
    fetchedAt: integer('fetched_at').notNull(),
    staleAfter: integer('stale_after').notNull(),
    etag: text('etag'),
  },
  (t) => [primaryKey({ columns: [t.repoId, t.number] })],
)

// --- App-state table: data GitHub doesn't have, we are the source of truth ---

export const prefs = sqliteTable(
  'prefs',
  {
    userId: text('user_id').notNull(),
    key: text('key').notNull(), // theme, diff view mode, keybinding overrides, …
    value: text('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
)
