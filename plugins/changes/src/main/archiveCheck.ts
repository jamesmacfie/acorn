// What the changes plugin has to say when the owner archives a task: which files they are about to
// throw away, not merely how many.
//
// Moved here from a `registerWillHandler` in the desktop shell, which read the polled `TaskStatus` and
// could therefore only ever report a COUNT — `worktreePorcelain` parses `git status --porcelain` and
// discards the lines. This plugin's own node half already runs that command and keeps the paths, so
// asking it is both the shorter path and the better answer, and the 10-second status poll does not
// have to start carrying per-task path lists for a dialog that opens once in a while.
//
// Advisory: there is no `apply`. Committing or discarding on the owner's behalf as a side effect of
// archiving is exactly the destructive thing a confirmation dialog exists to avoid.
import type { TaskConcern, TaskRef } from '@acorn/plugin-api/node'
import type { LocalGitBridge } from '../server/routes/localGit'

/** How many paths the concern sends. The dialog draws at most five and counts the rest; sending six
 *  would be sending one the host will not draw. */
const SHOWN = 5

export async function changesArchiveConcern(bridge: LocalGitBridge, task: TaskRef): Promise<TaskConcern | null> {
  // Nothing to lose without a worktree of its own — a branchless task runs in the project folder, and
  // archiving it removes nothing.
  if (!task.worktreePath) return null
  const changes = await bridge.changes(task.id)
  if (!changes.length) return null
  return {
    id: 'uncommitted',
    severity: 'danger',
    message: `${changes.length} uncommitted file${changes.length === 1 ? '' : 's'}`,
    details: changes.slice(0, SHOWN).map((change) => change.path),
    detailsMore: Math.max(0, changes.length - SHOWN),
  }
}
