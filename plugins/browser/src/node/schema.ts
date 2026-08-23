import { blob, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// The browser plugin's one table (docs/data-layer.md § Plugin DBs). Lives in
// <data-root>/plugins/browser.sqlite with its own Drizzle chain, migrated at plugin init.
//
// Screenshot bytes are stored, not inlined into a transcript as base64, so they outlive the transcript
// and stay addressable by id. See docs/agent-tools.md § Browser tools.
//
// `task_id` is a plain id into core's `tasks`, dereferenced through CoreServices.tasks, never joined.
export const browserCaptures = sqliteTable(
  'browser_captures',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(),
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    body: blob('body', { mode: 'buffer' }).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('browser_captures_task_idx').on(table.taskId, table.createdAt)],
)
