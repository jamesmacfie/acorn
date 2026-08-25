// Local-changes review backing: working-tree status, per-file patch and blob reads, plus stage,
// commit, discard, and push over the task's worktree. The LocalGitBridge behind the HTTP routes in
// server/routes/localGit.ts. The taskId is the capability, and relative paths are validated inside
// localDiff.ts. Pure Node, so it works in dev:node too. Wired in main/serverBridges.ts.
import type { CoreServices } from '@acorn/plugin-api/node'
import type { LocalGitBridge } from '../server/routes/localGit'
import { commitStaged, discardAll, discardFile, localChanges, localDiff, localNewSideText, pushBranch, stageAll, stageFile, unstageAll, unstageFile } from './localDiff'

// Takes CoreServices, not a database handle: this module shells out to git in the task's worktree
// and needs only core's task-to-worktree resolution (docs/data-layer.md § Plugin databases).
export function localGitBridge(core: Pick<CoreServices, 'tasks'>, broadcastStatus: () => void = () => {}): LocalGitBridge {
  // A mutation resolves the root, runs the git action, then pings status so dirty markers move.
  const withRoot = async (taskId: string, fn: (root: string) => Promise<{ ok: boolean; reason?: string }>) => {
    const root = await core.tasks.root(taskId)
    if (!root) return { ok: false, reason: 'No worktree yet.' }
    const res = await fn(root)
    broadcastStatus()
    return res
  }
  return {
    changes: async (taskId) => {
      const root = await core.tasks.root(taskId)
      if (!root) return []
      return localChanges(root).catch(() => [])
    },
    diff: async (taskId, path, scope) => {
      const root = await core.tasks.root(taskId)
      if (!root) return { error: 'No worktree yet.' }
      try {
        // Whole-file context: the pane shows the entire file with changes highlighted, so no expand
        // affordances are needed. 1e6 lines caps any real file.
        // git's default -U3, so the pane shows hunks with expandable gaps between them rather than
        // every line of every file (docs/diff-rendering.md).
        return await localDiff(root, path, scope === 'staged' ? 'staged' : 'unstaged')
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'diff failed' }
      }
    },
    newSide: async (taskId, path, scope) => {
      const root = await core.tasks.root(taskId)
      if (!root) return { error: 'No worktree yet.' }
      try {
        return await localNewSideText(root, path, scope === 'staged' ? 'staged' : 'unstaged')
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'read failed' }
      }
    },
    stage: (taskId, path) => withRoot(taskId, (root) => stageFile(root, path)),
    unstage: (taskId, path) => withRoot(taskId, (root) => unstageFile(root, path)),
    discard: (taskId, path, untracked) => withRoot(taskId, (root) => discardFile(root, path, !!untracked)),
    commit: (taskId, message) => withRoot(taskId, (root) => commitStaged(root, message)),
    stageAll: (taskId) => withRoot(taskId, stageAll),
    unstageAll: (taskId) => withRoot(taskId, unstageAll),
    discardAll: (taskId) => withRoot(taskId, discardAll),
    push: (taskId) => withRoot(taskId, (root) => pushBranch(root)),
  }
}
