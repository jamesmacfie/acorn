// The database plugin's own tables (docs/data-layer.md § Plugin DBs). Lives in
// <data-root>/plugins/database.sqlite with its own Drizzle chain, migrated at plugin init.
//
// Moved out of @acorn/node-core's schema.ts: a saved SQL snippet is this pane's data and core has no
// reason to know its shape. The row is scoped by projectId — an opaque core ID resolved through
// CoreServices rather than joined against core's `tasks`, because a query never spans database files.
import { sqliteTable, integer, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// Named SQL snippets for the Database pane (docs/pg.md). Project-scoped, NOT task-scoped: a query
// written against a project's schema outlives any one task worktree. Machine-scoped (no user_id).
// Saving under an existing project/name overwrites it.
export const dbSavedQueries = sqliteTable(
  'db_saved_queries',
  {
    id: text('id').primaryKey(), // opaque uuid
    projectId: text('project_id'), // → CoreServices.projects.byId (plain ID, not a foreign key)
    name: text('name').notNull(),
    notes: text('notes'), // what it answers / gotchas — sent alongside the SQL as AI-generation context
    sql: text('sql').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('db_saved_queries_project_name_idx').on(t.projectId, t.name)],
)
