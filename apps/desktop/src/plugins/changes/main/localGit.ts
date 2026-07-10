// Local-changes review backing (docs/panes.md): working-tree status / per-file patch / blob read
// + stage/commit/discard/push over the task's worktree. Was the `local:*` IPC channels (preload
// group `terminal.local`); now the LocalGitBridge behind the HTTP routes in server/routes/localGit.ts
// (Phase 3). The taskId is the capability; relative paths are validated inside localDiff.ts. Pure-
// Node, so it works in dev:node too; wired in main/serverBridges.ts.
import type { LocalGitBridge } from '../server/routes/localGit'
import type { AppDatabase } from '../../../core/server/db'
import { commitStaged, discardAll, discardFile, localChanges, localDiff, localFileBlob, pushBranch, stageAll, stageFile, unstageAll, unstageFile } from './localDiff'
import { broadcastStatus } from '../../../core/main/notify'
import { taskRoot } from '../../../core/main/taskWorktree'

export function localGitBridge(db: AppDatabase): LocalGitBridge {
  // A mutation resolves the root, runs the git action, then pings status so dirty markers move.
  const withRoot = async (taskId: string, fn: (root: string) => Promise<{ ok: boolean; reason?: string }>) => {
    const root = await taskRoot(db, taskId)
    if (!root) return { ok: false, reason: 'No worktree yet.' }
    const res = await fn(root)
    broadcastStatus()
    return res
  }
  return {
    changes: async (taskId) => {
      const root = await taskRoot(db, taskId)
      if (!root) return []
      return localChanges(root).catch(() => [])
    },
    diff: async (taskId, path, scope) => {
      const root = await taskRoot(db, taskId)
      if (!root) return { error: 'No worktree yet.' }
      try {
        // Whole-file context (docs/panes.md): the pane shows the entire file with changes
        // highlighted, so no expand affordances are needed. 1e6 lines caps any real file.
        return await localDiff(root, path, scope === 'staged' ? 'staged' : 'unstaged', 1_000_000)
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'diff failed' }
      }
    },
    blob: async (taskId, path, ref) => {
      const root = await taskRoot(db, taskId)
      if (!root) return { error: 'No worktree yet.' }
      try {
        return await localFileBlob(root, path, ref ?? 'HEAD')
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
