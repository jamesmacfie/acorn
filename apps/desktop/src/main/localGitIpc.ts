// The local-git + editor IPC surfaces (preload groups `terminal.local` and `editor`), split out of
// terminal.ts. Both operate on the task's worktree via taskRoot — the taskId is the capability;
// relative paths are validated (resolveInRoot / repo-relative checks inside localDiff.ts).
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { execFile } from 'node:child_process'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import type { AppDatabase } from '../server/db'
import { commitStaged, discardFile, localChanges, localDiff, localFileBlob, pushBranch, stageFile, unstageFile, type LocalScope } from './localDiff'
import { broadcastStatus } from './notify'
import { resolveInRoot, taskRoot } from './taskWorktree'

export function registerLocalGitIpc(db: AppDatabase): void {
  // Local-changes review (docs/panes.md): parsed status / per-file unified patch / blob read
  // against the task's worktree.
  ipcMain.handle('local:changes', async (_e: IpcMainInvokeEvent, taskId: string) => {
    const root = await taskRoot(db, taskId)
    if (!root) return []
    try {
      return await localChanges(root)
    } catch {
      return []
    }
  })

  ipcMain.handle('local:diff', async (_e: IpcMainInvokeEvent, p: { taskId: string; path: string; scope: LocalScope }): Promise<{ patch: string } | { error: string }> => {
    const root = await taskRoot(db, p?.taskId)
    if (!root) return { error: 'No worktree yet.' }
    try {
      // Whole-file context (docs/panes.md): the pane shows the entire file with changes highlighted,
      // so no expand affordances are needed. 1e6 lines caps any real file.
      return await localDiff(root, p.path, p.scope === 'staged' ? 'staged' : 'unstaged', 1_000_000)
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'diff failed' }
    }
  })

  ipcMain.handle('local:blob', async (_e: IpcMainInvokeEvent, p: { taskId: string; path: string; ref?: string }): Promise<{ text: string } | { error: string }> => {
    const root = await taskRoot(db, p?.taskId)
    if (!root) return { error: 'No worktree yet.' }
    try {
      return await localFileBlob(root, p.path, p.ref ?? 'HEAD')
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'read failed' }
    }
  })

  // Stage/commit actions (docs/panes.md). Discard is destructive — the renderer confirms before
  // calling; main still keeps the path validation.
  const withRoot = async (taskId: string, fn: (root: string) => Promise<{ ok: boolean; reason?: string }>) => {
    const root = await taskRoot(db, taskId)
    if (!root) return { ok: false, reason: 'No worktree yet.' }
    const res = await fn(root)
    broadcastStatus() // dirty markers move immediately
    return res
  }
  ipcMain.handle('local:stage', (_e: IpcMainInvokeEvent, p: { taskId: string; path: string }) => withRoot(p?.taskId, (root) => stageFile(root, p.path)))
  ipcMain.handle('local:unstage', (_e: IpcMainInvokeEvent, p: { taskId: string; path: string }) => withRoot(p?.taskId, (root) => unstageFile(root, p.path)))
  ipcMain.handle('local:discard', (_e: IpcMainInvokeEvent, p: { taskId: string; path: string; untracked?: boolean }) =>
    withRoot(p?.taskId, (root) => discardFile(root, p.path, !!p.untracked)),
  )
  ipcMain.handle('local:commit', (_e: IpcMainInvokeEvent, p: { taskId: string; message: string }) =>
    withRoot(p?.taskId, (root) => commitStaged(root, typeof p.message === 'string' ? p.message : '')),
  )
  ipcMain.handle('local:push', (_e: IpcMainInvokeEvent, p: { taskId: string }) => withRoot(p?.taskId, (root) => pushBranch(root)))

  // Monaco editor pane (docs/workspaces): read/write files on the task's worktree. Local-only, so
  // IPC not HTTP. All calls are keyed by taskId + a relative path confined to the worktree root by
  // resolveInRoot — the renderer never hands us an absolute path.
  ipcMain.handle('editor:root', (_e: IpcMainInvokeEvent, taskId: string): Promise<string | null> => taskRoot(db, taskId))

  ipcMain.handle('editor:list', async (_e: IpcMainInvokeEvent, p: { taskId: string; relPath: string }): Promise<{ name: string; dir: boolean }[]> => {
    const root = await taskRoot(db, p.taskId)
    const abs = root && resolveInRoot(root, p.relPath)
    if (!abs) return []
    const ents = await readdir(abs, { withFileTypes: true })
    return ents
      .filter((e) => e.name !== '.git' && e.name !== 'node_modules')
      .map((e) => ({ name: e.name, dir: e.isDirectory() }))
      .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
  })

  // Flat file list for the ⌘P quick-open palette. `git ls-files` gives the tracked + untracked
  // (non-ignored) set — the same files VS Code's Cmd+P offers — without walking node_modules.
  ipcMain.handle('editor:files', async (_e: IpcMainInvokeEvent, taskId: string): Promise<string[]> => {
    const root = await taskRoot(db, taskId)
    if (!root) return []
    const { stdout } = await promisify(execFile)('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard'], {
      timeout: 10_000,
      maxBuffer: 32 * 1024 * 1024,
    }).catch(() => ({ stdout: '' }))
    return stdout.split('\n').filter(Boolean)
  })

  ipcMain.handle('editor:read', async (_e: IpcMainInvokeEvent, p: { taskId: string; relPath: string }): Promise<string> => {
    const root = await taskRoot(db, p.taskId)
    const abs = root && resolveInRoot(root, p.relPath)
    if (!abs) throw new Error('Path outside worktree.')
    return readFile(abs, 'utf8')
  })

  ipcMain.handle('editor:write', async (_e: IpcMainInvokeEvent, p: { taskId: string; relPath: string; content: string }): Promise<{ ok: boolean; reason?: string }> => {
    const root = await taskRoot(db, p.taskId)
    const abs = root && resolveInRoot(root, p.relPath)
    if (!abs) return { ok: false, reason: 'Path outside worktree.' }
    try {
      await writeFile(abs, p.content, 'utf8')
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) }
    }
  })
}
