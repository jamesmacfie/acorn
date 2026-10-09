import { rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

// A deleted task's notes (docs/workspaces-and-tasks/archive.md § Deleting a task): its whole
// `task/<taskId>/` folder under the notes root. Notes promoted to the workspace keep their
// `originTaskId` and stay. Loaded on first use, to stay inside the service boot budget
// (apps/node/scripts/check-service-budget.mjs). Answers how many folders went.
export async function removeTaskFolders(root: string, taskIds: readonly string[]): Promise<number> {
  let removed = 0
  for (const taskId of taskIds) {
    // The folder-name rule NotesStore applies (./notes.ts § isValidDirKey), so no id reaches outside.
    if (!/^[A-Za-z0-9_-]+$/.test(taskId)) continue
    const dir = join(root, 'task', taskId)
    if (!(await stat(dir).catch(() => null))) continue
    await rm(dir, { recursive: true, force: true })
    removed += 1
  }
  return removed
}
