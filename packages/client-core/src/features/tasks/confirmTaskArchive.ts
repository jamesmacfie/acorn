import { confirmWillEvent, type WillDecision } from '../../host/registries/shell/willPhase'
import type { Task } from '../../infra/queries'

/** Task archive is destructive enough to require an explicit decision even when no plugin reports a
 * concern. Plugin concerns still populate the same dialog and return any selected cleanups.
 *
 * The message says what happens to the files. Archive deletes a worktree only when acorn made it: a
 * task with a branch and a checkout of its own. A task in the project folder leaves that folder as it
 * is (node-core/server/storage/archive.ts, `ownsWorktree`). */
export const confirmTaskArchive = (task: Pick<Task, 'id' | 'title' | 'branch' | 'worktreePath'>): Promise<WillDecision> => confirmWillEvent({
  kind: 'task:archive',
  payload: { taskId: task.id },
  title: 'Archive task',
  subject: task.title,
  actionLabel: 'Archive task',
  message: task.branch && task.worktreePath
    ? 'acorn stops this task\'s sessions and deletes its worktree. You can restore the task from Archive.'
    : 'acorn stops this task\'s sessions and leaves the project folder as it is. You can restore the task from Archive.',
  alwaysConfirm: true,
})
