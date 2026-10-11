// Editor pane backing: read, write, and list files on the task's worktree. The EditorBridge
// behind the HTTP routes in server/routes/editor.ts. The taskId is the capability, and every call
// re-derives the worktree root from the DB. Path confinement is `resolveInRoot` (docs/security/process-and-paths.md §
// Process, path, and configuration controls). Pure Node, so it works in dev:node too. Wired in
// node/index.ts.
import { BridgeError, type CoreServices, gitOrThrow, type PluginHookRegistry } from '@acorn/plugin-api/node'
import { createHash } from 'node:crypto'
import { lstat, open, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import type { EditorBridge, EditorEntry } from '../server/routes/editor'
import type { EditorLineMarkerProvider } from '../contract/lineMarkers'
import type { EditorFileStatusProvider } from '../contract/fileStatus'
import { MAX_IMAGE_PREVIEW_BYTES } from '../contract/imagePreview'
import { MAX_EDITOR_FILE_READ_BYTES, type EditorFilesCapability } from '../contract/files'
import { markerSnapshot, readMarkerProviders } from './markerSnapshot'
import { canonicalCheckoutKey, withFileWriteLock } from './fileWriteLock'
import { createFileActions, entryIdentity, entryKind, gitMetadata, stableEntryId } from './fileActions'
import { editorWorktreeChanged } from './worktreeInvalidation'

const revisionOf = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

async function diskRevision(path: string): Promise<string | null> {
  try {
    return revisionOf(await readFile(path))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

// The Node runs git in the worktree for every status refresh, so a saved `.git/config` with an
// `fsmonitor` setting would run a command as the person. A task token reaches this write, and a
// sandboxed agent can't write `.git` itself (docs/managed-agents/read-block.md), so the save refuses
// it too, by the path given and by the real path, which a symlink in the worktree could change.
async function inGitMetadata(root: string, relPath: string, abs: string): Promise<boolean> {
  if (gitMetadata(relPath)) return true
  try {
    const real = await realpath(abs).catch(async () => join(await realpath(dirname(abs)), basename(abs)))
    return gitMetadata(relative(await realpath(root), real))
  } catch {
    // No such folder, so the write below fails on its own.
    return false
  }
}
export type EditorCoreServices = Pick<CoreServices, 'tasks' | 'fs' | 'proc'>

// Confine relPath to the task's worktree; throw the HTTP-classified error the route surfaces.
// No worktree yet (unmapped repo) → 404; a path that escapes the root → 403 (never leaks whether
// the outside target exists).
async function confinedFile(
  core: EditorCoreServices,
  taskId: string,
  relPath: string,
): Promise<{ root: string; abs: string }> {
  const root = await core.tasks.root(taskId)
  if (!root) throw new BridgeError(404, 'no_worktree', 'No worktree for this task yet.')
  const abs = core.fs.resolveInRoot(root, relPath)
  if (!abs) throw new BridgeError(403, 'path_outside', 'Path is outside the worktree.')
  return { root, abs }
}

const confine = async (core: EditorCoreServices, taskId: string, relPath: string): Promise<string> =>
  (await confinedFile(core, taskId, relPath)).abs

/** `ctx.events.worktreeStatus`: "something under this task's worktree changed". Passed in rather than
 *  reached for, so this module stays plain Node and testable without a host. */
export type EditorChanged = (taskId: string) => void

export const editorBridge = (
  core: EditorCoreServices,
  changed: EditorChanged = () => {},
  /** The owner's half of `editor:before-save` (docs/plugins/hooks.md § Hooks). Absent means nobody objects,
   *  which is also what an empty chain means. */
  hooks?: Pick<PluginHookRegistry, 'run'>,
  /** Providers are resolved per read because plugin init order and unload are runtime facts. */
  markerProviders: () => readonly EditorLineMarkerProvider[] = () => [],
  fileStatusProviders: () => readonly EditorFileStatusProvider[] = () => [],
): EditorBridge => ({
  ...createFileActions(core, changed),
  root: (taskId) => core.tasks.root(taskId),
  ignored: async (taskId, relPath, names) =>
    (await import('./ignoredEntries')).ignoredEntries(core, taskId, relPath, names),

  list: async (taskId, relPath) => {
    const root = await core.tasks.root(taskId)
    const abs = root && core.fs.resolveInRoot(root, relPath)
    if (!abs) return [] // no worktree / bad path → empty tree, never an error
    const ents = await readdir(abs, { withFileTypes: true })
    const entries = await Promise.all(
      ents
        .filter((e) => e.name !== '.git' && e.name !== 'node_modules')
        .map(async (e): Promise<EditorEntry | null> => {
          try {
            const info = await lstat(join(abs, e.name))
            return {
              name: e.name,
              dir: info.isDirectory(),
              kind: entryKind(info),
              identity: entryIdentity(info),
              entryId: stableEntryId(info),
              root,
            }
          } catch {
            return null
          } // a disappearing row is absent, not a stale target
        }),
    )
    return entries
      .filter((entry): entry is EditorEntry => entry !== null)
      .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
  },

  // Flat file list for the quick-open palette. `git ls-files` gives the tracked and untracked
  // (non-ignored) set, the same files VS Code's Cmd+P offers, without walking node_modules.
  files: async (taskId) => {
    const root = await core.tasks.root(taskId)
    if (!root) return []
    const { stdout } = await gitOrThrow(['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      timeoutMs: 10_000,
      maxOutputBytes: 32 * 1024 * 1024,
    }).catch(() => ({ stdout: '' }))
    return stdout.split('\n').filter(Boolean)
  },

  read: async (taskId, relPath) => {
    const abs = await confine(core, taskId, relPath)
    try {
      const bytes = await readFile(abs)
      try {
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
        if (text.includes('\0')) throw new Error('Binary content')
        return { text, revision: revisionOf(bytes) }
      } catch {
        throw new BridgeError(422, 'unsupported_text', 'This file is not supported UTF-8 text.')
      }
    } catch (error) {
      if (error instanceof BridgeError) throw error
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new BridgeError(404, 'not_found', 'File not found.')
      throw error
    }
  },

  readImage: async (taskId, relPath) => {
    const abs = await confine(core, taskId, relPath)
    try {
      if ((await stat(abs)).size > MAX_IMAGE_PREVIEW_BYTES) {
        throw new BridgeError(422, 'image_too_large', 'Image is too large to preview.')
      }
      const bytes = await readFile(abs)
      if (bytes.byteLength > MAX_IMAGE_PREVIEW_BYTES) {
        throw new BridgeError(422, 'image_too_large', 'Image is too large to preview.')
      }
      return bytes
    } catch (error) {
      if (error instanceof BridgeError) throw error
      throw new BridgeError(404, 'not_found', 'File not found.')
    }
  },

  lineMarkers: async (taskId, relPath) => {
    // Apply the same confinement as a text read before another plugin receives the path.
    const { root } = await confinedFile(core, taskId, relPath)
    return readMarkerProviders(markerProviders(), taskId, relPath, root)
  },

  markerSnapshot: (taskId, relPath, revision) =>
    markerSnapshot(
      () => confinedFile(core, taskId, relPath),
      revision,
      (root) => readMarkerProviders(markerProviders(), taskId, relPath, root),
    ),

  fileStatus: async (taskId) => {
    const root = await core.tasks.root(taskId)
    if (!root) return { kind: 'unavailable' }
    const provider = fileStatusProviders()[0]
    if (!provider) return { kind: 'unavailable' }
    const result = await provider.read(taskId, { root })
    return fileStatusProviders()[0] === provider && (await core.tasks.root(taskId)) === root
      ? result
      : { kind: 'unavailable' }
  },

  // The additive acknowledgement names the exact body written after hooks. Path and filesystem
  // failures retain the {ok:false, reason} response used by file-pane recovery.
  write: async (taskId, relPath, content, expectedRevision) => {
    const root = await core.tasks.root(taskId)
    const abs = root && core.fs.resolveInRoot(root, relPath)
    if (!abs) return { ok: false, kind: 'failure', reason: 'Path is outside the worktree.' }
    if (await inGitMetadata(root, relPath, abs))
      return { ok: false, kind: 'failure', reason: 'Git metadata cannot be changed.' }
    const key = await canonicalCheckoutKey(root).catch(() => null)
    if (!key) return { ok: false, kind: 'failure', reason: 'Cannot resolve the file path.' }
    return withFileWriteLock(key, async () => {
      // Format on save, as somebody else's plugin (docs/plugins/hooks.md § Hooks). The autosave loop calls this
      // on every pause, so the chain's timeout is what keeps a slow formatter from stalling typing; a
      // handler that does not answer leaves the text as the person wrote it.
      const verdict = await hooks?.run('before-save', { taskId, path: relPath, text: content })
      if (verdict && !verdict.ok)
        return { ok: false as const, kind: 'failure' as const, reason: `${verdict.by}: ${verdict.reason}` }
      try {
        const text = verdict?.payload.text ?? content
        // Reconfine after an asynchronous hook. The comparison is immediately before the write;
        // arbitrary external writers can still race the check and replacement.
        if ((await core.tasks.root(taskId)) !== root || core.fs.resolveInRoot(root, relPath) !== abs) {
          return { ok: false as const, kind: 'failure' as const, reason: 'File path changed during save.' }
        }
        const current = await diskRevision(abs)
        if (current !== expectedRevision)
          return {
            ok: false as const,
            kind: (current === null ? 'deleted' : 'conflict') as 'deleted' | 'conflict',
            reason: current === null ? 'Deleted on disk.' : 'Changed on disk.',
          }
        if (expectedRevision === null) {
          await writeFile(abs, text, { encoding: 'utf8', flag: 'wx' })
        } else {
          // `r+` refuses deletion after the revision check. Plain `writeFile` would recreate it.
          const file = await open(abs, 'r+')
          try {
            await file.truncate(0)
            await file.writeFile(text, 'utf8')
          } finally {
            await file.close()
          }
        }
        // The coalesced `git status` for this worktree is now a lie, and `changed` below is what makes
        // every client re-read it (@acorn/plugin-api/node § worktreeStatusText).
        // Deliberately the ordinary invalidation ping and NOT an event: "file saved" stays refused
        // (docs/plugins/events.md § What is not an event). Without it, a save from another client moves nothing
        // on this one: its tree, its dirty markers and its git status go stale until something else pings
        // (docs/plugins/events.md § Hearing a core event).
        await editorWorktreeChanged(core, root, taskId, changed)
        const revision = revisionOf(Buffer.from(text, 'utf8'))
        const visible = await diskRevision(abs)
        if (visible !== revision)
          return {
            ok: false as const,
            kind: (visible === null ? 'deleted' : 'conflict') as 'deleted' | 'conflict',
            reason: visible === null ? 'Deleted on disk.' : 'Changed on disk.',
          }
        return { ok: true as const, text, revision }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST')
          return { ok: false as const, kind: 'conflict' as const, reason: 'Changed on disk.' }
        if ((e as NodeJS.ErrnoException).code === 'ENOENT')
          return { ok: false as const, kind: 'deleted' as const, reason: 'Deleted on disk.' }
        return { ok: false as const, kind: 'failure' as const, reason: e instanceof Error ? e.message : String(e) }
      }
    })
  },
})

/** `editor.files` (../contract/files.ts): the text read's confinement and the image read's size
 *  check, for another plugin's node part. Every refusal is `missing`, so the answer never says
 *  whether something exists outside the worktree. */
export const editorFiles = (core: EditorCoreServices): EditorFilesCapability => ({
  read: async ({ taskId, path }) => {
    try {
      const { abs } = await confinedFile(core, taskId, path)
      const { size } = await stat(abs)
      if (size > MAX_EDITOR_FILE_READ_BYTES) return { status: 'too_large', byteSize: size }
      const bytes = new Uint8Array(await readFile(abs))
      // The file can grow between the stat and the read.
      if (bytes.byteLength > MAX_EDITOR_FILE_READ_BYTES) return { status: 'too_large', byteSize: bytes.byteLength }
      return { status: 'ok', bytes, revision: revisionOf(bytes) }
    } catch {
      return { status: 'missing' }
    }
  },
})
