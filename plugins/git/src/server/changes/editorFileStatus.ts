import { realpath } from 'node:fs/promises'
import { git, worktreeStatusText, type CoreServices } from '@acorn/plugin-api/node'
import type { EditorFileStatusProvider } from '@acorn/plugin-editor/contract/fileStatus.ts'
import { parsePorcelainV2 } from './localDiff'

/** Status-only: one shared porcelain read; no numstat, patch, blob or per-file stat. */
export function changesEditorFileStatus(core: {
  tasks: Pick<CoreServices['tasks'], 'root'>
}): EditorFileStatusProvider {
  return {
    read: async (taskId, source) => {
      const root = await core.tasks.root(taskId)
      if (!root || (await realpath(root)) !== (await realpath(source.root))) return { kind: 'unavailable' }
      const checkout = await realpath(root)
      const text = await worktreeStatusText(checkout)
      if (text === null) {
        const probe = await git(['rev-parse', '--is-inside-work-tree'], { cwd: checkout, timeoutMs: 10_000 })
        if (probe.code === 128 && /not a git repository/i.test(probe.stderr)) return { kind: 'not-git' }
        throw new Error('Git status is temporarily unavailable.')
      }
      const changes = parsePorcelainV2(text).changes.map(({ path, oldPath, status, staged }) => ({
        path,
        ...(oldPath ? { oldPath } : {}),
        status,
        staged,
      }))
      return { kind: 'ready', changes }
    },
  }
}
