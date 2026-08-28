// Monaco editor pane backing: read, write, and list files on the task's worktree. The EditorBridge
// behind the HTTP routes in server/routes/editor.ts. The taskId is the capability, and every call
// re-derives the worktree root from the DB. Path confinement is `resolveInRoot` (docs/security.md §
// Process, path, and configuration controls). Pure Node, so it works in dev:node too. Wired in
// main/serverBridges.ts.
import { BridgeError, type CoreServices, gitOrThrow } from '@acorn/plugin-api/node'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import type { EditorBridge, EditorEntry } from '../server/routes/editor'

export type EditorCoreServices = Pick<CoreServices, 'tasks' | 'fs'>

// Confine relPath to the task's worktree; throw the HTTP-classified error the route surfaces.
// No worktree yet (unmapped repo) → 404; a path that escapes the root → 403 (never leaks whether
// the outside target exists).
async function confine(core: EditorCoreServices, taskId: string, relPath: string): Promise<string> {
  const root = await core.tasks.root(taskId)
  if (!root) throw new BridgeError(404, 'no_worktree', 'No worktree for this task yet.')
  const abs = core.fs.resolveInRoot(root, relPath)
  if (!abs) throw new BridgeError(403, 'path_outside', 'Path is outside the worktree.')
  return abs
}

/** `ctx.events.status`, the content-free "go re-read" ping. Passed in rather than reached for, so this
 *  module stays plain Node and testable without a host. */
export type EditorChanged = () => void

export const editorBridge = (core: EditorCoreServices, changed: EditorChanged = () => {}): EditorBridge => ({
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
      return await readFile(abs, 'utf8')
    } catch {
      throw new BridgeError(404, 'not_found', 'File not found.')
    }
  },

  // Write keeps the {ok, reason} contract and never throws: EditorPane surfaces reason inline, and
  // the autosave loop must not see a rejected promise. A path escape is a benign {ok:false} rather
  // than a 4xx, because the renderer already confined the path and this check is a second layer.
  write: async (taskId, relPath, content) => {
    const root = await core.tasks.root(taskId)
    const abs = root && core.fs.resolveInRoot(root, relPath)
    if (!abs) return { ok: false, reason: 'Path is outside the worktree.' }
    try {
      await writeFile(abs, content, 'utf8')
      // Deliberately the ordinary invalidation ping and NOT an event: "file saved" stays refused
      // (docs/future/events/refused.md). A save from another client used to move nothing on this one —
      // its tree, its dirty markers and its git status all went stale until something else pinged
      // (docs/future/events/delivery.md defect 3).
      changed()
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) }
    }
  },
})
