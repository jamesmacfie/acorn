// Serializes a task's worktree creation against archive teardown.
//
// Archive cannot mark the database row archived before teardown succeeds, but leaving the row active
// lets a pane resolve and recreate the worktree while it is being removed. This process-local gate
// closes that interval without adding a persisted lifecycle state that would need crash recovery.
const archiving = new Set<string>()

/** Claims one task for archive. False means another archive already owns it. */
export function beginTaskArchive(taskId: string): boolean {
  if (archiving.has(taskId)) return false
  archiving.add(taskId)
  return true
}

export const isTaskArchiving = (taskId: string): boolean => archiving.has(taskId)

/** Releases a claim after success or any refusal, so a failed teardown can be retried. */
export function finishTaskArchive(taskId: string): void {
  archiving.delete(taskId)
}
