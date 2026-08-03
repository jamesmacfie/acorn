// The memory plugin's own tables (docs/vNext/data.md § Plugin DBs). Lives in
// <data-root>/plugins/memory.sqlite with its own Drizzle chain, migrated at plugin init.
//
// Moved out of @acorn/node-core's schema.ts: the memory index is this plugin's data, and core has no
// reason to know its shape. Nothing here references another database — `repo` is a plain
// 'owner/name' string, resolved from a task through CoreServices.tasks rather than joined, because a
// query never spans database files.
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Memory index (docs/notes-and-memory.md): markdown files are the TRUTH (<worktree>/.acorn/memory
// committed, ~/.acorn/memory private); this table is a derived index reconciled on change from all
// active worktrees + primary checkouts. id = content hash (idempotent across N checkouts); conflicts
// on (scope, repo, name) resolve newest-updatedAt. Machine-scoped.
//
// The companion FTS5 virtual table (`memories_fts`, porter stemming over name/description/body) is
// created BY HAND in this chain's migration — drizzle-kit does not model virtual tables, so it cannot
// appear here. server/routes/knowledge.ts's search path reads it with raw SQL, and
// migrations/0000_*.sql is the only place its shape is stated; keep the two in step.
export const memories = sqliteTable('memories', {
  id: text('id').primaryKey(), // sha256(content) prefix
  scope: text('scope').notNull(), // 'repo' | 'private'
  repo: text('repo'), // 'owner/name' for repo scope; null for private
  name: text('name').notNull(),
  type: text('type').notNull(), // convention|architecture|decision|fix|reference|feedback|task|user
  description: text('description').notNull(),
  body: text('body').notNull(),
  path: text('path').notNull(), // the winning file on disk
  originSessionId: text('origin_session_id'),
  commitSha: text('commit_sha'),
  supersededBy: text('superseded_by'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  lastAccessedAt: integer('last_accessed_at'),
  accessCount: integer('access_count').notNull().default(0),
})
