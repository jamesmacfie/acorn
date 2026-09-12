// The memory plugin's own tables (docs/data-layer.md § Plugin databases). Lives in
// <data-root>/plugins/memory.sqlite with its own Drizzle chain, migrated at plugin init.
//
// Nothing here references another database. project_id is an opaque string resolved through
// CoreServices.projects rather than joined, because a query never spans files.
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// Memory index (docs/notes-and-memory.md § Memory; docs/data-layer.md § Ownership rules for
// machine-scoped data). This table is the derived index, reconciled on change from every active
// worktree and primary checkout. id is a content hash, idempotent across checkouts; a conflict on
// (scope, project_id, name) resolves to the newest updatedAt.
//
// The companion FTS5 virtual table (`memories_fts`, porter stemming over name, description, and
// body) is created by hand in this chain's migration, because drizzle-kit does not model virtual
// tables. server/routes/knowledge.ts reads it with raw SQL, and migrations/0000_*.sql is the only
// place its shape is stated. Keep the two in step.
export const memories = sqliteTable('memories', {
  id: text('id').primaryKey(), // sha256(content) prefix
  scope: text('scope').notNull(), // 'project' | 'private'
  projectId: text('project_id'), // core project ID for project scope; null for private
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

// Durable promotion receipts survive findings being disabled or removed. The approved payload is
// frozen before the file write; retries reconcile the actual file hash and finish linkage once.
export const memoryPromotionReceipts = sqliteTable('memory_promotion_receipts', {
  operationId: text('operation_id').primaryKey(), candidateId: text('candidate_id').notNull(), candidateRevision: integer('candidate_revision').notNull(),
  payloadHash: text('payload_hash').notNull(), payloadJson: text('payload_json').notNull(), scopeJson: text('scope_json').notNull(), targetPathIdentity: text('target_path_identity').notNull(),
  expectedBaseHash: text('expected_base_hash'), deviceId: text('device_id').notNull(), state: text('state').notNull(), targetReference: text('target_reference'),
  failureCode: text('failure_code'), createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, (table) => [uniqueIndex('memory_promotion_receipts_candidate_revision_unique').on(table.candidateId, table.candidateRevision)])
