import { blob, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// The browser plugin's one table (docs/data-layer.md § Plugin DBs). Lives in
// <data-root>/plugins/browser.sqlite with its own Drizzle chain, migrated at plugin init.
//
// What a screenshot is for: an agent takes one, describes it, and moves on — but the bytes are the
// evidence for whatever it concluded, and inline base64 in a transcript is evidence that evaporates.
// A row keyed to the task is the smallest thing that survives, and a future audit trail at the
// tool-registry seam reads it by id (docs/future/tauri/webviews-and-frames.md § Agent browser
// automation).
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
