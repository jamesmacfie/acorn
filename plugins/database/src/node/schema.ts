// The database plugin's own tables (docs/data-layer.md § Plugin DBs). Lives in
// <data-root>/plugins/database.sqlite with its own Drizzle chain, migrated at plugin init.
//
// Moved out of @acorn/node-core's schema.ts: a saved SQL snippet is this pane's data and core has no
// reason to know its shape. The row is scoped by (repoOwner, repoName) — plain identifiers, resolved
// from a task through CoreServices.tasks rather than joined against core's `tasks`, because a query
// never spans database files.
import { sqliteTable, integer, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// Named SQL snippets for the Database pane (docs/pg.md). Repo-scoped, NOT task-scoped: a query
// written against a repo's schema outlives any one task worktree. Machine-scoped (no user_id).
// (owner, repo, name) is unique — saving under an existing name overwrites it, which is also how a
// query gets edited or renamed (there is no PATCH route).
export const dbSavedQueries = sqliteTable(
  'db_saved_queries',
  {
    id: text('id').primaryKey(), // opaque uuid
    repoOwner: text('repo_owner').notNull(), // → core tasks.repo_owner (plain identifier, not a foreign key)
    repoName: text('repo_name').notNull(),
    name: text('name').notNull(),
    notes: text('notes'), // what it answers / gotchas — sent alongside the SQL as AI-generation context
    sql: text('sql').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('db_saved_queries_repo_name_idx').on(t.repoOwner, t.repoName, t.name)],
)
