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

// The task's query editor, as a document (docs/future/monaco.md). It exists because the pane's editor
// is now the HOST's: a document surface is defined by a route that reads it and a route that writes it,
// so the text has to live somewhere the plugin can serve it from, and that is here.
//
// The visible change is that it PERSISTS. The compiled pane created Monaco with `value: ''` every time,
// so a half-written query died with the pane — which nobody ever chose, it was just what an unbacked
// editor does. TASK-scoped rather than project-scoped, unlike the saved queries above: a scratch buffer
// is what you are doing right now, and what you meant to keep has a Save button.
export const dbScratch = sqliteTable('db_scratch', {
  taskId: text('task_id').primaryKey(), // → CoreServices.tasks.load (plain ID, not a foreign key)
  sql: text('sql').notNull(),
  updatedAt: integer('updated_at').notNull(),
})
