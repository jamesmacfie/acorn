// The changes plugin's own tables. See docs/data-layer.md § Plugin databases.
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Inline review notes on uncommitted changes. Anchored to (path, side, line range) with the
// snippet captured, so a note survives the lines moving. When editor or browser annotations
// arrive, generalize the anchor (nullable anchorJson) instead of adding a second store. sentAt is
// stamped on delivery and cleared on edit (orca's pattern).
export const reviewNotes = sqliteTable('review_notes', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(), // → core tasks.id (plain ID, not a foreign key)
  path: text('path').notNull(), // repo-relative file
  side: text('side').notNull(), // 'additions' | 'deletions'
  startLine: integer('start_line').notNull(),
  endLine: integer('end_line').notNull(),
  snippet: text('snippet'), // the lines the note anchors to (for the prompt + re-anchoring)
  body: text('body').notNull(),
  sentAt: integer('sent_at'), // stamped on delivery; cleared on edit
  createdAt: integer('created_at').notNull(),
})
