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
  return result.code === 0 ? result.stdout.trim() : null
}

async function comparisonBase(core: MarkerCore, root: string, baseRef: string): Promise<string | null> {
  const valid = await core.git.git(['check-ref-format', '--branch', baseRef], { cwd: root, timeoutMs: 10_000 })
  if (valid.code !== 0) return null
  for (const ref of [`refs/remotes/origin/${baseRef}`, `refs/heads/${baseRef}`, baseRef]) {
    const commit = await gitText(core, root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
    if (commit) return commit
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
): EditorLineMarkerProvider => ({
  kind: 'pull-request',
  read: async (taskId, path) => {
    if (!isEditorRelativePath(path)) return []
    const [root, comparison] = await Promise.all([
      core.tasks.root(taskId),
      taskPullComparison(db, core, core.identity.active(), taskId),
    ])
    if (!root || !comparison?.baseRef || !comparison.headSha || !GIT_SHA.test(comparison.headSha)) return []
    const [pullHead, base] = await Promise.all([
      gitText(core, root, ['rev-parse', '--verify', '--quiet', `${comparison.headSha}^{commit}`]),
      comparisonBase(core, root, comparison.baseRef),
    ])
    if (!pullHead || !base) return []
    const mergeBase = await gitText(core, root, ['merge-base', pullHead, base])
    if (!mergeBase) return []
    const [pullPatch, worktreePatch] = await Promise.all([
      gitText(core, root, ['diff', '--no-ext-diff', '--unified=0', mergeBase, pullHead, '--', path]),
      gitText(core, root, ['diff', '--no-ext-diff', '--unified=0', pullHead, '--', path]),
    ])
    const pullRanges = changedLineRanges(pullPatch ?? '')
    return translateLineRanges(pullRanges, worktreePatch ?? '')
  },
})
