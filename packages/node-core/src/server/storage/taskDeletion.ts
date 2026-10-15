// Delete a task for good (docs/workspaces-and-tasks/archive.md § Deleting a task).
//
// Core removes its own rows and writes one tombstone per task in a single transaction. Every plugin's
// rows go afterwards, from the `core:task-deleted` hook and each plugin's daily catch-up, because a
// transaction never spans database files. The git branch stays: it can hold commits that exist
// nowhere else.
import { and, eq, inArray } from 'drizzle-orm'
import type { ArchiveResult, DeleteResult } from '@acorn/protocol/task.ts'
import type { AppDatabase } from '../db'
import { schema } from '../db'
import { taskArchiveTree, type TaskBusy } from './archive'
import { beginTaskArchive, finishTaskArchive } from '../worktrees/archiveGate'
import { taskScripts } from '../taskScripts/service'

export type DeleteDeps = {
  // Archives the tree, for a task that is still active. The route binds the owner's archive options
  // and the live-session bridge.
  archive: () => Promise<ArchiveResult>
  // The `core:task-deleted` hook chain (server/pluginHost/hooks.ts), injected like
  // ArchiveDeps.taskArchiving so this module never reaches into the server layer.
  taskDeleted?: (taskIds: string[]) => Promise<void>
}

export async function deleteTask(db: AppDatabase, id: string, deps: DeleteDeps): Promise<DeleteResult | TaskBusy> {
  const before = taskArchiveTree(db, id)
  if (!before.length) return { ok: false, reason: 'Task not found.' }
  let cleanupFailed: string[] | undefined
  if (before.some((task) => task.status !== 'archived')) {
    const archived = await deps.archive()
    if (!archived.ok) return archived
    cleanupFailed = archived.cleanupFailed
  }

  // From here to the commit nothing is awaited, so a restore either wrote before this read, and is
  // refused below, or finds the rows gone when it writes (./archive.ts § restoreTask). The claim
  // refuses an archive that is still tearing a subtask down.
  const tree = taskArchiveTree(db, id)
  if (!tree.length) return { ok: false, reason: 'Task not found.' }
  const taskIds = tree.map((task) => task.id)
  const claimed: string[] = []
  try {
    for (const taskId of taskIds) {
      if (!beginTaskArchive(taskId))
        return { ok: false, reason: 'The task is being archived. Try again when that finishes.', busy: true }
      claimed.push(taskId)
    }
    if (tree.some((task) => task.status !== 'archived')) {
      return { ok: false, reason: 'The task was restored while it was being deleted.', busy: true }
    }
    for (const taskId of taskIds) taskScripts(db).interruptTask(taskId, 'cancelled')
    removeTaskRows(db, taskIds)
  } finally {
    // Each release broadcasts the tasks change, which is what tells the clients the rows are gone.
    for (const taskId of claimed) finishTaskArchive(taskId)
  }
  await deps.taskDeleted?.(taskIds)
  return { ok: true, taskIds, ...(cleanupFailed?.length ? { cleanupFailed } : {}) }
}

// Every core row keyed by these tasks, and a tombstone for each, in one transaction.
function removeTaskRows(db: AppDatabase, taskIds: string[]): void {
  // A task-scoped client preference is stored as `<slice>:<node>/<task>`, or `<slice>:<task>` before
  // node qualification, with the ids percent-encoded (client-core infra/persistence/persistedState.ts
  // § storageKeyFor). Matched on that suffix.
  const suffixes = taskIds.flatMap((taskId) => [`/${encodeURIComponent(taskId)}`, `:${encodeURIComponent(taskId)}`])
  const deletedAt = Date.now()
  db.transaction((tx) => {
    tx.delete(schema.taskPulls).where(inArray(schema.taskPulls.taskId, taskIds)).run()
    tx.delete(schema.taskChangeRequests).where(inArray(schema.taskChangeRequests.taskId, taskIds)).run()
    tx.delete(schema.taskScriptAttempts).where(inArray(schema.taskScriptAttempts.taskId, taskIds)).run()
    tx.delete(schema.taskLinks).where(inArray(schema.taskLinks.taskId, taskIds)).run()
    tx.delete(schema.tasks).where(inArray(schema.tasks.id, taskIds)).run()
    // Scans every preference row, a few hundred on a real node. Index the task id if that grows.
    for (const pref of tx.select({ userId: schema.prefs.userId, key: schema.prefs.key }).from(schema.prefs).all()) {
      if (!suffixes.some((suffix) => pref.key.endsWith(suffix))) continue
      tx.delete(schema.prefs)
        .where(and(eq(schema.prefs.userId, pref.userId), eq(schema.prefs.key, pref.key)))
        .run()
    }
    tx.insert(schema.deletedTasks)
      .values(taskIds.map((taskId) => ({ id: taskId, deletedAt })))
      .onConflictDoNothing()
      .run()
  })
}
