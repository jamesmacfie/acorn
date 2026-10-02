import type { CoreServices } from '@acorn/plugin-api/node'
import { changedLineRanges, isEditorRelativePath, type EditorLineMarkerProvider } from '@acorn/plugin-editor/contract/lineMarkers.ts'

type MarkerCore = Pick<CoreServices, 'tasks' | 'git'>

const diff = async (core: MarkerCore, root: string, path: string): Promise<string> => {
  const tracked = await core.git.git(['ls-files', '--error-unmatch', '--', `:(literal)${path}`], {
    cwd: root,
    timeoutMs: 10_000,
  })
  const hasHead = await core.git.git(['rev-parse', '--verify', '--quiet', 'HEAD'], {
    cwd: root,
    timeoutMs: 10_000,
  })
  // An untracked file, or every file in an unborn repository, is an addition from an empty document.
  // `--no-index` returns 1 when it found the expected difference, so its exit code is data.
  if (tracked.code !== 0 || hasHead.code !== 0) {
    const result = await core.git.git(['diff', '--no-ext-diff', '--no-textconv', '--no-index', '--unified=0', '--', '/dev/null', path], {
      cwd: root,
      timeoutMs: 15_000,
    })
    if (result.truncated || (result.code !== 0 && result.code !== 1)) throw new Error('Marker comparison unavailable')
    return result.stdout
  }
  const result = await core.git.git(['diff', '--no-ext-diff', '--no-textconv', '--unified=0', 'HEAD', '--', `:(literal)${path}`], {
    cwd: root,
    timeoutMs: 15_000,
  })
  if (result.truncated || result.code !== 0) throw new Error('Marker comparison unavailable')
  return result.stdout
}

export const uncommittedEditorLineMarkers = (core: MarkerCore): EditorLineMarkerProvider => ({
  kind: 'uncommitted',
  read: async (taskId, path, source) => {
    if (!isEditorRelativePath(path)) return []
    const root = await core.tasks.root(taskId)
    if (!root) return []
    if (source && source.root !== root) throw new Error('Marker worktree changed')
    return changedLineRanges(await diff(core, root, path))
  },
})
