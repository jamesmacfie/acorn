// Local-changes review backing: working-tree status, per-file patch and blob reads, plus stage,
// commit, discard, and push over the task's worktree. The LocalGitBridge behind the HTTP routes in
// server/routes/localGit.ts. The taskId is the capability, and relative paths are validated inside
// localDiff.ts. Pure Node, so it works in dev:node too. Wired in main/serverBridges.ts.
import type { CoreServices, PluginHookRegistry } from '@acorn/plugin-api/node'
import type { LocalGitBridge } from '../server/routes/localGit'
import { branchOf, commitStaged, discardAll, discardFile, localChanges, localDiff, localNewSideText, pushBranch, stageAll, stageFile, unstageAll, unstageFile } from './localDiff'

// The two decisions this plugin lets other plugins take a turn in (docs/plugins.md § Hooks). Declared
// on the context in node/index.ts; spelled here because this is where they are run, and a hook whose
// declaration and call site sit in different files drifts.
//
// `before-commit` allows a transform because rewriting the message is the whole point of a commit-lint
// or a message helper; `before-push` does not, because there is nothing in a push worth rewriting and
// a plugin that could change the branch could push somewhere else.
export const CHANGES_HOOKS = [
  {
    id: 'before-commit',
    label: 'commit',
    payload: { taskId: 'string', branch: 'string', message: 'string' },
    allows: ['observe', 'transform', 'veto'],
  },
  {
    id: 'before-push',
    label: 'push',
    payload: { taskId: 'string', branch: 'string' },
    allows: ['observe', 'veto'],
  },
] as const

// Takes CoreServices, not a database handle: this module shells out to git in the task's worktree
// and needs only core's task-to-worktree resolution (docs/data-layer.md § Plugin databases).
//
// `hooks` is the owner's half of the two points above. Optional so a test can build the bridge with no
// host around it, and absent means nobody objects, which is also what an empty chain means.
export function localGitBridge(
  core: Pick<CoreServices, 'tasks'>,
  broadcastStatus: () => void = () => {},
  hooks?: Pick<PluginHookRegistry, 'run'>,
): LocalGitBridge {
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
    // The two hooked mutations. The refusal reaches the pane as the same `{ ok: false, reason }` a git
    // failure does, with the blaming plugin's name in front of it, so the owner's UI needs no second
    // shape for "somebody said no" (docs/plugins.md § Hooks).
    commit: (taskId, message) => withRoot(taskId, async (root) => {
      const verdict = await hooks?.run('before-commit', { taskId, branch: await branchOf(root), message })
      if (verdict && !verdict.ok) return { ok: false, reason: `${verdict.by}: ${verdict.reason}` }
      // Transformed, or the original if nobody transformed. One value to act on either way.
      return commitStaged(root, verdict?.payload.message ?? message)
    }),
    stageAll: (taskId) => withRoot(taskId, stageAll),
    unstageAll: (taskId) => withRoot(taskId, unstageAll),
    discardAll: (taskId) => withRoot(taskId, discardAll),
    push: (taskId) => withRoot(taskId, async (root) => {
      const verdict = await hooks?.run('before-push', { taskId, branch: await branchOf(root) })
      if (verdict && !verdict.ok) return { ok: false, reason: `${verdict.by}: ${verdict.reason}` }
      return pushBranch(root)
    }),
  }
}
