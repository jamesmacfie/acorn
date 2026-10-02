import type { CoreServices, PluginDatabase } from '@acorn/plugin-api/node'
import {
  changedLineRanges,
  isEditorRelativePath,
  translateLineRanges,
  type EditorLineMarkerProvider,
} from '@acorn/plugin-editor/contract/lineMarkers.ts'
import { taskPullComparison } from './mirrorQueries'

type MarkerCore = Pick<CoreServices, 'tasks' | 'projects' | 'identity' | 'git'>
const GIT_SHA = /^[0-9a-f]{40}$/i

const gitText = async (core: MarkerCore, root: string, args: string[]): Promise<string | null> => {
  const result = await core.git.git(args, { cwd: root, timeoutMs: 15_000 })
  return result.code === 0 && !result.truncated ? result.stdout.trim() : null
}

async function comparisonBase(core: MarkerCore, root: string, baseRef: string): Promise<string | null> {
  const valid = await core.git.git(['check-ref-format', '--branch', baseRef], { cwd: root, timeoutMs: 10_000 })
  if (valid.code !== 0) return null
  for (const ref of [`refs/remotes/origin/${baseRef}`, `refs/heads/${baseRef}`, baseRef]) {
    const commit = await gitText(core, root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
    if (commit && GIT_SHA.test(commit)) return commit
  }
  return null
}

/**
 * Pull-request lines in the local working document. Both PR ends come from GitHub's mirror. A second
 * diff translates those PR-head coordinates through later local commits and uncommitted edits before
 * they reach the editor, without incorrectly treating unpushed commits as part of the pull request.
 */
export const pullRequestEditorLineMarkers = (
  db: PluginDatabase,
  core: MarkerCore,
): EditorLineMarkerProvider => {
  // Only active resolutions join. Neither mutable refs nor rejected promises survive a wave.
  const waves = new Map<string, Promise<{ pullHead: string; mergeBase: string } | null>>()
  const resolveComparison = async (root: string, headSha: string, baseRef: string) => {
    const [pullHead, base] = await Promise.all([
      gitText(core, root, ['rev-parse', '--verify', '--quiet', `${headSha}^{commit}`]),
      comparisonBase(core, root, baseRef),
    ])
    if (!pullHead || pullHead.toLowerCase() !== headSha.toLowerCase() || !base) return null
    const mergeBase = await gitText(core, root, ['merge-base', pullHead, base])
    return mergeBase && GIT_SHA.test(mergeBase) ? { pullHead, mergeBase } : null
  }
  return {
    kind: 'pull-request',
    read: async (taskId, path, source) => {
      if (!isEditorRelativePath(path)) return []
      const userId = core.identity.active()
      const [root, comparison] = await Promise.all([
        core.tasks.root(taskId),
        taskPullComparison(db, core, userId, taskId),
      ])
      if (!root || !comparison?.baseRef || !comparison.headSha || !GIT_SHA.test(comparison.headSha)) return []
      if (source && source.root !== root) throw new Error('Marker worktree changed')
      const key = JSON.stringify([root, comparison.userId, comparison.repoId, comparison.number, comparison.baseRef, comparison.headSha])
      let wave = waves.get(key)
      if (!wave) {
        wave = resolveComparison(root, comparison.headSha, comparison.baseRef).finally(() => { waves.delete(key) })
        waves.set(key, wave)
      }
      const resolved = await wave
      if (!resolved) return []
      const { pullHead, mergeBase } = resolved
      const [pullPatch, worktreePatch] = await Promise.all([
        gitText(core, root, ['diff', '--no-ext-diff', '--no-textconv', '--unified=0', mergeBase, pullHead, '--', `:(literal)${path}`]),
        gitText(core, root, ['diff', '--no-ext-diff', '--no-textconv', '--unified=0', pullHead, '--', `:(literal)${path}`]),
      ])
      // A failed translation cannot honestly reuse PR-head coordinates in the working document.
      if (pullPatch === null || worktreePatch === null) throw new Error('Marker comparison unavailable')
      return translateLineRanges(changedLineRanges(pullPatch), worktreePatch)
    },
  }
}
