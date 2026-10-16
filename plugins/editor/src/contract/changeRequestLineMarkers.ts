import type { CoreServices } from '@acorn/plugin-api/node'
import {
  changedLineRanges,
  isEditorRelativePath,
  translateLineRanges,
  type EditorLineMarkerProvider,
} from './lineMarkers'

// Kept out of ./lineMarkers.ts, which every code host imports at boot for the point id, so this code
// loads with a host's first marker read.

/** The two ends of a change request a marker provider compares: its target branch and its head
 *  commit, from the code host's mirror. `key` names the change request, so concurrent reads of one
 *  share their git work. */
export type ChangeRequestComparison = { key: string; baseRef: string; headSha: string }

type MarkerCore = Pick<CoreServices, 'tasks' | 'git'>
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
 * A code host's change request lines in the local working document. Both ends come from the host's
 * mirror. A second diff translates those head coordinates through later local commits and uncommitted
 * edits before they reach the editor, without treating unpushed commits as part of the change request.
 */
export const changeRequestLineMarkers = (
  core: MarkerCore,
  comparisonFor: (taskId: string) => Promise<ChangeRequestComparison | null>,
): EditorLineMarkerProvider => {
  // Only active resolutions join. Neither mutable refs nor rejected promises survive a wave.
  const waves = new Map<string, Promise<{ head: string; mergeBase: string } | null>>()
  const resolveComparison = async (root: string, headSha: string, baseRef: string) => {
    const [head, base] = await Promise.all([
      gitText(core, root, ['rev-parse', '--verify', '--quiet', `${headSha}^{commit}`]),
      comparisonBase(core, root, baseRef),
    ])
    if (!head || head.toLowerCase() !== headSha.toLowerCase() || !base) return null
    const mergeBase = await gitText(core, root, ['merge-base', head, base])
    return mergeBase && GIT_SHA.test(mergeBase) ? { head, mergeBase } : null
  }
  return {
    kind: 'pull-request',
    read: async (taskId, path, source) => {
      if (!isEditorRelativePath(path)) return []
      const [root, comparison] = await Promise.all([core.tasks.root(taskId), comparisonFor(taskId)])
      if (!root || !comparison?.baseRef || !comparison.headSha || !GIT_SHA.test(comparison.headSha)) return []
      if (source && source.root !== root) throw new Error('Marker worktree changed')
      const key = JSON.stringify([root, comparison.key, comparison.baseRef, comparison.headSha])
      let wave = waves.get(key)
      if (!wave) {
        wave = resolveComparison(root, comparison.headSha, comparison.baseRef).finally(() => {
          waves.delete(key)
        })
        waves.set(key, wave)
      }
      const resolved = await wave
      if (!resolved) return []
      const { head, mergeBase } = resolved
      const diff = (from: string, to?: string) =>
        gitText(core, root, [
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--unified=0',
          from,
          ...(to ? [to] : []),
          '--',
          `:(literal)${path}`,
        ])
      const [changePatch, worktreePatch] = await Promise.all([diff(mergeBase, head), diff(head)])
      // A failed translation cannot honestly reuse head coordinates in the working document.
      if (changePatch === null || worktreePatch === null) throw new Error('Marker comparison unavailable')
      return translateLineRanges(changedLineRanges(changePatch), worktreePatch)
    },
  }
}
