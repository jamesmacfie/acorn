import type { ArchiveResult, DeleteOpts } from '@acorn/protocol/task.ts'
import { confirmWillEvent, type WillAction, type WillDecision } from '../../host/registries/shell/willPhase'
import type { Task } from '../../infra/queries'
import { taskBridge } from './taskBridge'
import { archiveTask } from './taskMutations'

// The dialog's two actions (docs/workspaces-and-tasks/archive.md § Deleting a task). A caller hands the
// chosen one, `WillDecision.action`, to archiveOrDeleteTask below.
const ARCHIVE_TASK_ACTION = 'archive'
const DELETE_TASK_ACTION = 'delete'
const deleteTask: WillAction = {
  id: DELETE_TASK_ACTION,
  label: 'Delete task',
  danger: true,
  warning:
    "Deleting removes this task, its subtasks, and their agent conversations, notes, and saved requests. You can't restore a deleted task. The git branch stays.",
}

/** Task archive is destructive enough to require an explicit decision even when no plugin reports a
 * concern. Plugin concerns still populate the same dialog and return any selected cleanups.
 *
 * The message says what happens to the files. Archive deletes a worktree only when acorn made it: a
 * task with a branch and a checkout of its own. A task in the project folder leaves that folder as it
 * is (`ownsWorktree`). */
export const confirmTaskArchive = (
  task: Pick<Task, 'id' | 'title' | 'branch' | 'worktreePath'>,
): Promise<WillDecision> =>
  confirmWillEvent({
    kind: 'task:archive',
    payload: { taskId: task.id },
    title: 'Archive task',
    subject: task.title,
    actions: [{ id: ARCHIVE_TASK_ACTION, label: 'Archive task' }, deleteTask],
    message:
      task.branch && task.worktreePath
        ? "acorn stops this task's sessions and deletes its worktree. All subtasks, including nested subtasks, will also be archived. You can restore tasks from Archive."
        : "acorn stops this task's sessions and leaves the project folder as it is. All subtasks, including nested subtasks, will also be archived. You can restore tasks from Archive.",
    alwaysConfirm: true,
  })

/** The Archive page's Delete: the same dialog, with deleting as the only action. */
export const confirmTaskDelete = (task: Pick<Task, 'id' | 'title'>): Promise<WillDecision> =>
  confirmWillEvent({
    kind: 'task:delete',
    payload: { taskId: task.id },
    title: 'Delete task',
    subject: task.title,
    actions: [deleteTask],
    alwaysConfirm: true,
  })

/**
 * Carries out the dialog's choice. `guarded` is the node's archive route, the teardown the terminal
 * plugin runs; without it the status is flipped instead, and the node deletes the archived tree.
 *
 * A delete answers in archive's shape, so a caller's one completion path serves both: a deleted tree
 * leaves the rail the way an archived one does.
 */
export async function archiveOrDeleteTask(
  taskId: string,
  action: string,
  opts: DeleteOpts & { guarded: boolean },
): Promise<ArchiveResult> {
  const { guarded, ...archiveOpts } = opts
  const bridge = taskBridge()
  if (!guarded) {
    const archivedTaskIds = (await archiveTask(taskId)).archivedTaskIds ?? [taskId]
    if (action !== DELETE_TASK_ACTION) return { ok: true, archivedTaskIds }
    const deleted = await bridge.task.delete(taskId)
    return deleted.ok ? { ok: true, archivedTaskIds: deleted.taskIds } : { ...deleted, archivedTaskIds }
  }
  if (action !== DELETE_TASK_ACTION) return bridge.task.archive(taskId, { deleteWorktree: true, ...archiveOpts })
  const deleted = await bridge.task.delete(taskId, archiveOpts)
  if (!deleted.ok) return deleted
  return {
    ok: true,
    archivedTaskIds: deleted.taskIds,
    ...(deleted.cleanupFailed ? { cleanupFailed: deleted.cleanupFailed } : {}),
  }
}
