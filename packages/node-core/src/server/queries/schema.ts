import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const queryPublicationHolds = sqliteTable('query_publication_holds', {
  queryId: text('query_id').primaryKey(),
  operationId: text('operation_id').notNull(),
  plan: text('plan').notNull(),
  revision: integer('revision'),
  released: integer('released', { mode: 'boolean' }).notNull().default(false),
})

export const queryDrafts = sqliteTable('query_drafts', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id'),
  content: text('content').notNull(),
  draftRevision: integer('draft_revision').notNull(),
  basePublishedRevision: integer('base_published_revision'),
  publishedRevision: integer('published_revision'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})
export const queryRevisions = sqliteTable('query_revisions', {
  queryId: text('query_id').notNull(),
  revision: integer('revision').notNull(),
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id'),
  content: text('content').notNull(),
  digest: text('digest').notNull(),
  sourceRevision: text('source_revision').notNull(),
  createdAt: integer('created_at').notNull(),
}, t => [primaryKey({ columns: [t.queryId, t.revision] })])
export const queryConsumers = sqliteTable('query_consumers', {
  queryId: text('query_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id'),
  pluginId: text('plugin_id').notNull(),
  kind: text('kind').notNull(),
  consumerId: text('consumer_id').notNull(),
  content: text('content').notNull(),
}, t => [primaryKey({ columns: [t.queryId, t.pluginId, t.kind, t.consumerId] })])
