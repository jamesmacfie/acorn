// changes' task check: which files an archive would discard (docs/plugins.md § Task checks).
// This plugin's node half already parses `git status --porcelain` for its own bridge, so the check
// reuses those paths instead of the polled TaskStatus count.
import type { TaskConcern, TaskRef } from '@acorn/plugin-api/node'
import type { LocalGitBridge } from '../server/routes/localGit'

/** How many paths the concern sends; capped at five per docs/plugins.md § Task checks. */
const SHOWN = 5

export async function changesArchiveConcern(bridge: LocalGitBridge, task: TaskRef): Promise<TaskConcern | null> {
  // A branchless task runs in the project folder rather than its own worktree, so archiving it
  // removes nothing.
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
