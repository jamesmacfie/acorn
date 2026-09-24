import type { RestoreResult } from '@acorn/protocol/terminal.ts'
import { confirmWillEvent } from '../../host/registries/shell/willPhase'
import { taskBridge } from './taskBridge'

// Restore an archived task (docs/workspaces-and-tasks.md § Restoring a task). The node rebuilds the
// worktree before it answers, so a failure here is one the owner has to act on. A deleted branch is
// asked about, not assumed: restoring anyway puts the task on a new branch with none of its commits.
//
// `null` means the owner backed out. Callers invalidate tasksKey and the archived list after.
export async function restoreTask(taskId: string): Promise<RestoreResult | null> {
  const bridge = taskBridge()
  const first = await bridge.task.restore(taskId)
  if (first.ok || !first.branchMissing) return first
  const decision = await confirmWillEvent({
    kind: 'task:restore',
    payload: { taskId },
    title: 'Branch no longer exists',
    actionLabel: 'Restore on a new branch',
    message: `${first.reason} Restore the task on a new branch cut from the project's current checkout? Its old commits will not be on it.`,
    alwaysConfirm: true,
  })
  if (!decision.confirmed) return null
  return bridge.task.restore(taskId, { newBranch: true })
}
