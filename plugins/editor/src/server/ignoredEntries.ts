import { stat } from 'node:fs/promises'
import { git } from '@acorn/plugin-api/node'
import type { EditorCoreServices } from './editor'
import type { IgnoreEntries } from '../contract/api'

// One machine-format Git read for a requested directory. Its input and output are bounded, and
// NUL separators preserve filenames containing newlines or Git's ordinary quote characters.
export async function ignoredEntries(
  core: { tasks: Pick<EditorCoreServices['tasks'], 'root'>; fs: Pick<EditorCoreServices['fs'], 'resolveInRoot'> },
  taskId: string,
  directory: string,
  names: string[],
): Promise<IgnoreEntries> {
  const unavailable = (reason: string): IgnoreEntries => ({ available: false, ignored: [], reason })
  const root = await core.tasks.root(taskId)
  if (!root) return unavailable('This task has no worktree.')
  const abs = core.fs.resolveInRoot(root, directory)
  if (
    !abs ||
    !(await stat(abs)
      .then((info) => info.isDirectory())
      .catch(() => false))
  )
    return unavailable('The folder is unavailable.')
  const paths = names.map((name) => (directory ? `${directory}/${name}` : name))
  if (
    names.length > 10000 ||
    names.some((name) => !name || name === '.' || name === '..' || name.includes('/') || name.includes('\0')) ||
    Buffer.byteLength(paths.join('\0')) > 256 * 1024
  )
    return unavailable('Too many directory entries to read ignore rules.')
  if (!names.length) return { available: true, ignored: [] }
  try {
    const result = await git(['check-ignore', '--stdin', '-z'], {
      cwd: root,
      stdin: `${paths.join('\0')}\0`,
      maxOutputBytes: 512 * 1024,
      timeoutMs: 5000,
    })
    if ((await core.tasks.root(taskId)) !== root) return unavailable('The task worktree changed.')
    if (result.code !== 0 && result.code !== 1) return unavailable('Git ignore rules are unavailable.')
    const prefix = directory ? `${directory}/` : ''
    const valid = new Set(names)
    return {
      available: true,
      ignored: result.stdout
        .split('\0')
        .filter((path) => path.startsWith(prefix))
        .map((path) => path.slice(prefix.length))
        .filter((name) => valid.has(name)),
    }
  } catch {
    return unavailable('Git ignore rules are unavailable.')
  }
}
