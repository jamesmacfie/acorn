// Editor pane backing: read, write, and list files on the task's worktree. The EditorBridge
// behind the HTTP routes in server/routes/editor.ts. The taskId is the capability, and every call
// re-derives the worktree root from the DB. Path confinement is `resolveInRoot` (docs/security/process-and-paths.md §
// Process, path, and configuration controls). Pure Node, so it works in dev:node too. Wired in
// node/index.ts.
import { BridgeError, type CoreServices, gitOrThrow, invalidateWorktreeStatus, type PluginHookRegistry } from '@acorn/plugin-api/node'
import { createHash } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import type { EditorBridge, EditorEntry } from '../server/routes/editor'
import type { EditorLineMarkerProvider } from '../contract/lineMarkers'
import { MAX_IMAGE_PREVIEW_BYTES } from '../contract/imagePreview'
import { markerSnapshot, readMarkerProviders } from './markerSnapshot'

export type EditorCoreServices = Pick<CoreServices, 'tasks' | 'fs'>

// Confine relPath to the task's worktree; throw the HTTP-classified error the route surfaces.
// No worktree yet (unmapped repo) → 404; a path that escapes the root → 403 (never leaks whether
// the outside target exists).
async function confinedFile(core: EditorCoreServices, taskId: string, relPath: string): Promise<{ root: string; abs: string }> {
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
): EditorBridge => ({
  root: (taskId) => core.tasks.root(taskId),

  list: async (taskId, relPath) => {
    const root = await core.tasks.root(taskId)
    const abs = root && core.fs.resolveInRoot(root, relPath)
    if (!abs) return [] // no worktree / bad path → empty tree, never an error
    const ents = await readdir(abs, { withFileTypes: true })
    return ents
      .filter((e) => e.name !== '.git' && e.name !== 'node_modules')
      .map((e): EditorEntry => ({ name: e.name, dir: e.isDirectory() }))
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
        return text
      } catch {
        throw new BridgeError(422, 'unsupported_text', 'This file is not supported UTF-8 text.')
      }
    } catch (error) {
      if (error instanceof BridgeError) throw error
      throw new BridgeError(404, 'not_found', 'File not found.')
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

  markerSnapshot: (taskId, relPath, revision) => markerSnapshot(
    () => confinedFile(core, taskId, relPath),
    revision,
    (root) => readMarkerProviders(markerProviders(), taskId, relPath, root),
  ),

  // The additive acknowledgement names the exact body written after hooks. Path and filesystem
  // failures retain the {ok:false, reason} response used by file-pane recovery.
  write: async (taskId, relPath, content) => {
    const root = await core.tasks.root(taskId)
    const abs = root && core.fs.resolveInRoot(root, relPath)
    if (!abs) return { ok: false, reason: 'Path is outside the worktree.' }
    // Format on save, as somebody else's plugin (docs/plugins/hooks.md § Hooks). The autosave loop calls this
    // on every pause, so the chain's timeout is what keeps a slow formatter from stalling typing; a
    // handler that does not answer leaves the text as the person wrote it.
    const verdict = await hooks?.run('before-save', { taskId, path: relPath, text: content })
    if (verdict && !verdict.ok) return { ok: false, reason: `${verdict.by}: ${verdict.reason}` }
    try {
      const text = verdict?.payload.text ?? content
      await writeFile(abs, text, 'utf8')
      // The coalesced `git status` for this worktree is now a lie, and `changed` below is what makes
      // every client re-read it (@acorn/plugin-api/node § worktreeStatusText).
      invalidateWorktreeStatus(root)
      // Deliberately the ordinary invalidation ping and NOT an event: "file saved" stays refused
      // (docs/plugins/events.md § What is not an event). A save from another client used to move nothing on this one —
      // its tree, its dirty markers and its git status all went stale until something else pinged
      // (docs/plugins/events.md § Hearing a core event).
      changed(taskId)
      return { ok: true, text, revision: createHash('sha256').update(text, 'utf8').digest('hex') }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) }
    }
  },
})
