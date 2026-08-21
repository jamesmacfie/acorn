import { and, eq, like } from 'drizzle-orm'
import * as schema from './schema'
import type { AppDatabase } from './index'

// Application-level cascade for disconnecting an integration (docs/data-layer.md § External-item
// read model: the schema declares no foreign keys). If you add a table keyed by integrationId,
// delete its rows below before the integrations row.
export const cascadeDeleteIntegration = async (db: AppDatabase, userId: string, id: string) => {
  await db.batch([
    db.delete(schema.workspaceExternalProjects).where(eq(schema.workspaceExternalProjects.integrationId, id)),
    db.delete(schema.issues).where(and(eq(schema.issues.userId, userId), eq(schema.issues.integrationId, id))),
    db.delete(schema.issueResources).where(and(eq(schema.issueResources.userId, userId), eq(schema.issueResources.integrationId, id))),
    db.delete(schema.syncState).where(and(eq(schema.syncState.userId, userId), like(schema.syncState.resource, `provider:%:${id}:%`))),
    db.delete(schema.taskLinks).where(eq(schema.taskLinks.integrationId, id)),
    db.delete(schema.integrations).where(and(eq(schema.integrations.id, id), eq(schema.integrations.userId, userId))),
  ])
}
