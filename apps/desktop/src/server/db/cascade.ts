import { and, eq } from 'drizzle-orm'
import * as schema from './schema'
import type { AppDatabase } from './index'

// Application-level cascade for disconnecting an integration. The schema declares no foreign
// keys (docs/data-layer.md), so every table keyed by integrationId must be cleaned up here —
// if you add one, delete its rows below before the integrations row.
export const cascadeDeleteIntegration = async (db: AppDatabase, userId: string, id: string) => {
  await db.batch([
    db.delete(schema.workspaceProjects).where(eq(schema.workspaceProjects.integrationId, id)),
    db.delete(schema.issues).where(and(eq(schema.issues.userId, userId), eq(schema.issues.integrationId, id))),
    db.delete(schema.taskLinks).where(eq(schema.taskLinks.integrationId, id)),
    db.delete(schema.integrations).where(and(eq(schema.integrations.id, id), eq(schema.integrations.userId, userId))),
  ])
}
