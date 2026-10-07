// Task-addressed file actions. The Node re-derives the checkout for every request; the client
// supplies the entry it saw so a stale menu cannot mutate a replacement entry.
import { lstat, mkdir, open, readdir, rename } from 'node:fs/promises'
import { basename, dirname, join, relative, sep } from 'node:path'
import { platform } from 'node:os'
import { randomUUID } from 'node:crypto'
import { BridgeError } from '@acorn/plugin-api/node'
import type { FileActionResult, FileEntryKind, FileTarget, TrashAvailability } from '../contract/api'
import type { EditorCoreServices, EditorChanged } from './editor'
import { canonicalCheckoutKey, withFileWriteLock } from './fileWriteLock'
import { activeEditorUnder } from './editorPtyOwners'
import { editorWorktreeChanged } from './worktreeInvalidation'

const validName = (name: string): boolean => !!name && name !== '.' && name !== '..' && !/[\\/\0]/.test(name) && name.toLowerCase() !== '.git'
const gitMetadata = (path: string): boolean => path.split(/[\\/]/).some((part) => part.toLowerCase() === '.git')
export const entryIdentity = (info: { dev: number; ino: number; birthtimeMs: number; ctimeMs: number }): string =>
  `${info.dev}:${info.ino}:${info.birthtimeMs}:${info.ctimeMs}`
export const entryKind = (info: { isSymbolicLink(): boolean; isDirectory(): boolean }): FileEntryKind =>
  info.isSymbolicLink() ? 'link' : info.isDirectory() ? 'folder' : 'file'
const failure = (reason: string, partial = false): FileActionResult => ({ ok: false, reason, ...(partial ? { partial } : {}) })
const reason = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

async function rootFor(core: EditorCoreServices, taskId: string, expected?: string): Promise<string> {
  const root = await core.tasks.root(taskId)
  if (!root || (expected !== undefined && root !== expected)) throw new Error('The task checkout changed. Refresh the tree.')
  return root
}

// A leaf symlink is an entry in its parent, not permission to follow its target. Resolve the
// parent through the shared confinement service and lstat the leaf itself.
function entryPath(core: EditorCoreServices, root: string, path: string, allowRoot = false): string {
  if (!path) {
    if (allowRoot) return root
    throw new Error('The worktree root cannot be changed.')
  }
  if (gitMetadata(path)) throw new Error('Git metadata cannot be changed.')
  if (path.split(/[\/]/).some((part) => !part || part === '.' || part === '..')) throw new Error('Use a normalized worktree path.')
  const name = basename(path)
  if (!validName(name)) throw new Error('Invalid file name.')
  const parent = dirname(path) === '.' ? '' : dirname(path)
  const absParent = core.fs.resolveInRoot(root, parent)
  if (!absParent) throw new Error('Path is outside the worktree.')
  const abs = join(absParent, name)
  const rel = relative(root, abs)
  if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Path is outside the worktree.')
  return abs
}

async function checkTarget(core: EditorCoreServices, target: FileTarget, root: string, allowRoot = false): Promise<string> {
  const abs = entryPath(core, root, target.path, allowRoot)
  const info = await lstat(abs)
  if (entryIdentity(info) !== target.identity || entryKind(info) !== target.kind) throw new Error('The tree entry changed. Refresh and try again.')
  return abs
}

async function absent(path: string): Promise<boolean> {
  try { await lstat(path); return false }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return true; throw cause }
}

export function createFileActions(core: EditorCoreServices, changed: EditorChanged) {
  const announce = (root: string, taskId: string): Promise<void> => editorWorktreeChanged(core, root, taskId, changed)
  const trashAvailability = async (taskId: string): Promise<TrashAvailability> => {
    if (platform() === 'darwin') {
      try { await lstat('/usr/bin/trash'); return { available: true } }
      catch { return { available: false, reason: 'The Node host has no system trash command.' } }
    }
    if (platform() === 'linux') {
      const root = await core.tasks.root(taskId)
      if (!root) return { available: false, reason: 'This task has no checkout.' }
      const result = await core.proc.runProcess({ file: 'gio', args: ['version'], cwd: root, timeoutMs: 3_000, maxOutputBytes: 1_024 })
      return result.code === 0
        ? { available: true }
        : { available: false, reason: 'Install GIO on the Node host to move files to trash.' }
    }
    return { available: false, reason: 'System trash is unavailable on this Node host.' }
  }
  const moveToTrash = async (root: string, path: string): Promise<void> => {
    const file = platform() === 'darwin' ? '/usr/bin/trash' : 'gio'
    const args = platform() === 'darwin' ? ['-s', path] : ['trash', '--', path]
    await core.proc.runProcessOrThrow({ file, args, cwd: root, timeoutMs: 30_000, maxOutputBytes: 8_192 })
  }
  return {
    entry: async (taskId: string, path: string): Promise<FileTarget> => {
      try {
        const root = await rootFor(core, taskId)
        const abs = entryPath(core, root, path, true)
        const info = await lstat(abs)
        return { root, path, kind: entryKind(info), identity: entryIdentity(info) }
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') throw new BridgeError(404, 'not_found', 'Tree entry not found.')
        throw new BridgeError(403, 'path_outside', reason(cause))
      }
    },
    trashAvailability,
    create: async (taskId: string, parent: FileTarget, name: string, kind: 'file' | 'folder'): Promise<FileActionResult> => {
      if (!validName(name)) return failure('Enter one valid file name.')
      try {
        const root = await rootFor(core, taskId, parent.root)
        return await withFileWriteLock(await canonicalCheckoutKey(root), async () => {
          await rootFor(core, taskId, parent.root)
          await checkTarget(core, parent, root, true)
          if (parent.kind !== 'folder') return failure('Choose a folder.')
          const path = parent.path ? `${parent.path}/${name}` : name
          const abs = entryPath(core, root, path)
          if (kind === 'folder') await mkdir(abs)
          else { const handle = await open(abs, 'wx'); await handle.close() }
          await announce(root, taskId)
          return { ok: true, path }
        })
      } catch (cause) { return failure(reason(cause)) }
    },
    rename: async (taskId: string, source: FileTarget, name: string): Promise<FileActionResult> => {
      if (!validName(name)) return failure('Enter one valid file name.')
      try {
        const root = await rootFor(core, taskId, source.root)
        return await withFileWriteLock(await canonicalCheckoutKey(root), async () => {
          await rootFor(core, taskId, source.root)
          const from = await checkTarget(core, source, root)
          if (await activeEditorUnder(root, source.path)) return failure('Close $EDITOR on this entry or a descendant before renaming it.')
          const path = source.path.includes('/') ? `${source.path.slice(0, source.path.lastIndexOf('/'))}/${name}` : name
          const to = entryPath(core, root, path)
          if (from === to) return { ok: true, path }
          // On case-insensitive filesystems, a case-only destination names the source itself.
          // Move through a unique sibling and roll back if the second move fails.
          const destination = await lstat(to).catch((cause: unknown) => {
            if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null
            throw cause
          })
          const sourceInfo = await lstat(from)
          const exactDestination = (await readdir(dirname(from))).includes(name)
          const sameEntry = !!destination && !exactDestination
            && destination.dev === sourceInfo.dev && destination.ino === sourceInfo.ino
            && name.toLowerCase() === basename(from).toLowerCase()
          if (!sameEntry && !await absent(to)) return failure('A file or folder already has that name.')
          if (sameEntry) {
            const intermediate = join(dirname(from), `.acorn-rename-${randomUUID()}`)
            await rename(from, intermediate)
            try { await rename(intermediate, to) }
            catch (cause) {
              try { await rename(intermediate, from) }
              catch { return failure(`Rename failed and the entry may remain at ${intermediate}. ${reason(cause)}`, true) }
              throw cause
            }
          } else await rename(from, to)
          await announce(root, taskId)
          return { ok: true, path }
        })
      } catch (cause) { return failure(reason(cause)) }
    },
    trash: async (taskId: string, source: FileTarget): Promise<FileActionResult> => {
      try {
        const support = await trashAvailability(taskId)
        if (!support.available) return failure(support.reason ?? 'System trash is unavailable.')
        const root = await rootFor(core, taskId, source.root)
        return await withFileWriteLock(await canonicalCheckoutKey(root), async () => {
          await rootFor(core, taskId, source.root)
          const abs = await checkTarget(core, source, root)
          if (await activeEditorUnder(root, source.path)) return failure('Close $EDITOR on this entry or a descendant before moving it to trash.')
          try { await moveToTrash(root, abs) }
          catch (cause) {
            const stillHere = await absent(abs)
            if (stillHere) await announce(root, taskId)
            return failure(`The Node could not confirm the trash operation: ${reason(cause)}`, stillHere)
          }
          if (!await absent(abs)) return failure('The trash command returned but the entry is still present.')
          await announce(root, taskId)
          return { ok: true, path: source.path }
        })
      } catch (cause) { return failure(reason(cause)) }
    },
  }
}
