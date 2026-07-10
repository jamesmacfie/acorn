// Monaco editor pane backing (docs/workspaces-and-tasks.md): read/write/list files on the task's worktree.
// Was the `editor:*` IPC channels; now the EditorBridge behind the HTTP routes
// in server/routes/editor.ts. The taskId is the capability — every call re-derives the
// worktree root from the DB and confines the renderer-supplied relative path with resolveInRoot,
// so a traversal (`../`) or a symlink pointing outside the worktree is rejected. Pure-Node, so it
// works in dev:node too; wired in main/serverBridges.ts.
import { execFile } from 'node:child_process'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { BridgeError } from '../../../core/server/bridge'
import type { AppDatabase } from '../../../core/server/db'
import type { EditorBridge, EditorEntry } from '../server/routes/editor'
import { resolveInRoot, taskRoot } from '../../../core/main/taskWorktree'

// Confine relPath to the task's worktree; throw the HTTP-classified error the route surfaces.
// No worktree yet (unmapped repo) → 404; a path that escapes the root → 403 (never leaks whether
// the outside target exists).
async function confine(db: AppDatabase, taskId: string, relPath: string): Promise<string> {
  const root = await taskRoot(db, taskId)
  if (!root) throw new BridgeError(404, 'no_worktree', 'No worktree for this task yet.')
  const abs = resolveInRoot(root, relPath)
  if (!abs) throw new BridgeError(403, 'path_outside', 'Path is outside the worktree.')
  return abs
}

export const editorBridge = (db: AppDatabase): EditorBridge => ({
  root: (taskId) => taskRoot(db, taskId),

  list: async (taskId, relPath) => {
    const root = await taskRoot(db, taskId)
    const abs = root && resolveInRoot(root, relPath)
    if (!abs) return [] // no worktree / bad path → empty tree, never an error
    const ents = await readdir(abs, { withFileTypes: true })
    return ents
      .filter((e) => e.name !== '.git' && e.name !== 'node_modules')
      .map((e): EditorEntry => ({ name: e.name, dir: e.isDirectory() }))
      .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
  },

  // Flat file list for ⌘P quick-open. `git ls-files` gives the tracked + untracked (non-ignored)
  // set — the same files VS Code's Cmd+P offers — without walking node_modules.
  files: async (taskId) => {
    const root = await taskRoot(db, taskId)
    if (!root) return []
    const { stdout } = await promisify(execFile)('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard'], {
      timeout: 10_000,
      maxBuffer: 32 * 1024 * 1024,
    }).catch(() => ({ stdout: '' }))
    return stdout.split('\n').filter(Boolean)
  },

  read: async (taskId, relPath) => {
    const abs = await confine(db, taskId, relPath)
    try {
      return await readFile(abs, 'utf8')
    } catch {
      throw new BridgeError(404, 'not_found', 'File not found.')
    }
  },

  // Write keeps the {ok, reason} contract (never throws) — EditorPane surfaces reason inline and
  // the autosave loop must not see a rejected promise. A path escape is a benign {ok:false}, not a
  // 4xx: the renderer already confined the path, so this is defense-in-depth, not a caller error.
  write: async (taskId, relPath, content) => {
    const root = await taskRoot(db, taskId)
    const abs = root && resolveInRoot(root, relPath)
    if (!abs) return { ok: false, reason: 'Path is outside the worktree.' }
    try {
      await writeFile(abs, content, 'utf8')
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) }
    }
  },
})
