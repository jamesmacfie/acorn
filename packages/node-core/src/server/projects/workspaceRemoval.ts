import { and, eq, inArray } from 'drizzle-orm'
import type { AppDatabase } from '../db'
import { schema } from '../db'
import { deleteWorkspaceDatasets } from '../datasets/store'
import { pruneWorkspaceImages } from './workspaceImages'
import { broadcastWorkspaceChanged, broadcastWorkspaceProjectsChanged } from '../notify'

/** Database half of workspace removal. Call inside the owning transaction. */
export function removeWorkspaceRows(
  db: Pick<AppDatabase, 'select' | 'delete'>,
  datasetDb: AppDatabase,
  workspaceId: string,
  ownerId: string,
): string[] {
  const links = db
    .select({ integrationId: schema.workspaceExternalProjects.integrationId })
    .from(schema.workspaceExternalProjects)
    .where(eq(schema.workspaceExternalProjects.workspaceId, workspaceId))
    .all()
  const ids = [...new Set(links.map((link) => link.integrationId))]
  const providers = ids.length
    ? db
        .select({ provider: schema.integrations.provider })
        .from(schema.integrations)
        .where(and(inArray(schema.integrations.id, ids), eq(schema.integrations.userId, ownerId)))
        .all()
        .map((row) => row.provider)
    : []
  db.delete(schema.workspaceExternalProjects).where(eq(schema.workspaceExternalProjects.workspaceId, workspaceId)).run()
  deleteWorkspaceDatasets(datasetDb, workspaceId)
  db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)).run()
  pruneWorkspaceImages(db)
  return [...new Set(providers)]
}

/** Notification half: must run only after the transaction commits. */
export function notifyWorkspaceRemoved(workspaceId: string, providers: readonly string[]): void {
  for (const providerId of providers) broadcastWorkspaceProjectsChanged({ providerId, workspaceIds: [workspaceId] })
  broadcastWorkspaceChanged({ workspaceId })
}
