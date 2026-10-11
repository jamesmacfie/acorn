import type { CoreServices } from '@acorn/plugin-api/node'
import type { CleanupResult } from '../shared/api'
import { inventory } from './worktreeRoster'

type Core = Pick<CoreServices, 'git' | 'projects' | 'tasks'>
const pending = new Set<string>()

/** The request contains a roster observation, never a caller-selected filesystem path. */
export async function cleanup(core: Core, projectId: string, expected: string): Promise<CleanupResult> {
  const current = await inventory(core, projectId)
  const refuse = (error: string): CleanupResult => ({ ok: false, error, inventory: current })
  if (current.error || !current.repository) return refuse(current.error ?? 'Repository unavailable.')
  const entry = current.worktrees.find((worktree) => worktree.observation === expected)
  if (!entry) return refuse('This worktree changed since it was shown. Refresh and try again.')
  if (pending.has(current.repository)) return refuse('Another worktree cleanup is in progress. Refresh and try again.')
  pending.add(current.repository)
  try {
    // Re-read inside the local mutation guard. The guard serializes Acorn cleanup requests for this
    // repository; external Git clients can still change state, and Git's own refusal is reported.
    const fresh = await inventory(core, projectId)
    const target = fresh.worktrees.find((worktree) => worktree.observation === expected)
    if (!target || fresh.repository !== current.repository)
      return { ok: false, error: 'This worktree changed. Refresh and try again.', inventory: fresh }
    if (target.main) return { ok: false, error: 'The main checkout cannot be removed.', inventory: fresh }
    if (target.locked) return { ok: false, error: 'This worktree is locked.', inventory: fresh }
    if (target.owners.length)
      return {
        ok: false,
        error: `This worktree belongs to ${target.owners.map((owner) => owner.title).join(', ')}. Open or archive its task.`,
        inventory: fresh,
      }
    if (target.error || (target.dirty !== false && !target.prunable))
      return {
        ok: false,
        error: target.error ?? 'Resolve changes in this worktree before removing it.',
        inventory: fresh,
      }
    if (target.prunable) {
      const missing = fresh.worktrees.filter((worktree) => worktree.prunable)
      if (missing.some((worktree) => worktree.main || worktree.locked || worktree.owners.length)) {
        return { ok: false, error: 'Prune would affect a protected worktree registration.', inventory: fresh }
      }
    }
    const args = target.prunable ? ['worktree', 'prune', '--expire=now'] : ['worktree', 'remove', '--', target.path]
    const result = await core.git.git(args, { cwd: fresh.repository })
    const after = await inventory(core, projectId)
    if (result.code !== 0)
      return { ok: false, error: result.stderr.trim().split('\n')[0] || 'Git refused the removal.', inventory: after }
    if (after.error) return { ok: false, error: after.error, inventory: after }
    if (after.worktrees.some((worktree) => worktree.id === target.id)) {
      return { ok: false, error: 'Git kept this worktree registration. Refresh and try again.', inventory: after }
    }
    return { ok: true, inventory: after }
  } finally {
    pending.delete(current.repository)
  }
}
