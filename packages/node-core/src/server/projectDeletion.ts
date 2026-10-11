import { eq, inArray } from 'drizzle-orm'
import type { AppDatabase } from './db'
import { schema } from './db'
import { getProject } from './projects'
import { taskScripts } from './taskScripts/service'
import { retireTaskHead } from './worktrees/taskHeadObserver'
import { broadcastProjectChanged, broadcastTasksChanged } from './notify'
import { nodeWorkspacesMode } from './workspacesMode'

/** Delete rows together; folders and task worktrees remain on disk. */
export async function deleteProject(db: AppDatabase, id: string, ownerId = ''): Promise<void> {
  const project = await getProject(db, id)
  if (!project) return
  const removeWorkspace = nodeWorkspacesMode(db, ownerId) === 'off'
  // Load before the synchronous transaction. Workspace removal itself loads dataset storage only
  // when a project deletion actually needs it, and every row deletion still commits together.
  const removal = removeWorkspace ? await import('./workspaceRemoval') : null
  const taskIds = (
    await db.select({ id: schema.tasks.id }).from(schema.tasks).where(eq(schema.tasks.projectId, id))
  ).map((row) => row.id)
  for (const taskId of taskIds) taskScripts(db).interruptTask(taskId, 'cancelled')
  const removedProviders = db.transaction((tx) => {
    if (taskIds.length) {
      tx.delete(schema.taskPulls).where(inArray(schema.taskPulls.taskId, taskIds)).run()
      tx.delete(schema.taskScriptAttempts).where(inArray(schema.taskScriptAttempts.taskId, taskIds)).run()
      tx.delete(schema.taskLinks).where(inArray(schema.taskLinks.taskId, taskIds)).run()
      tx.delete(schema.tasks).where(inArray(schema.tasks.id, taskIds)).run()
    }
    tx.delete(schema.projects).where(eq(schema.projects.id, id)).run()
    return removal ? removal.removeWorkspaceRows(tx, db, project.workspaceId, ownerId) : []
  })
  for (const taskId of taskIds) retireTaskHead(taskId)
  removal?.notifyWorkspaceRemoved(project.workspaceId, removedProviders)
  if (taskIds.length) broadcastTasksChanged({ taskId: null })
  broadcastProjectChanged({ projectId: id })
}
