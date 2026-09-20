import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const dashboardDrafts = sqliteTable('dashboard_drafts', {
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

export const dashboardRevisions = sqliteTable('dashboard_revisions', {
  dashboardId: text('dashboard_id').notNull(),
  revision: integer('revision').notNull(),
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id'),
  content: text('content').notNull(),
  digest: text('digest').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [primaryKey({ columns: [table.dashboardId, table.revision] })])
