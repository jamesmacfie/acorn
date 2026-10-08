import { eq } from 'drizzle-orm'
import type { AppDatabase } from './db'
import { schema } from './db'
import { broadcastProjectChanged } from './notify'

/** Reject stale membership and save the complete order in one transaction. */
export function reorderWorkspaceProjects(db: AppDatabase, workspaceId: string, projectIds: readonly string[]) {
  const result = db.transaction((tx) => {
    if (!tx.select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)).get()) {
      return 'not_found' as const
    }
    const members = tx.select({ id: schema.projects.id, sort: schema.projects.sort }).from(schema.projects)
      .where(eq(schema.projects.workspaceId, workspaceId)).all()
    const ids = new Set(projectIds)
    if (ids.size !== projectIds.length || members.length !== ids.size || members.some((project) => !ids.has(project.id))) {
      return 'membership_changed' as const
    }
    const sorts = new Map(members.map((project) => [project.id, project.sort]))
    const changed: string[] = []
    const now = Date.now()
    projectIds.forEach((id, sort) => {
      if (sorts.get(id) === sort) return
      tx.update(schema.projects).set({ sort, updatedAt: now }).where(eq(schema.projects.id, id)).run()
      changed.push(id)
    })
    return changed
  })
  if (Array.isArray(result)) {
    for (const projectId of result) broadcastProjectChanged({ projectId })
  }
  return result
}
