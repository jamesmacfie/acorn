import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { CreateOpts, ServerMsg } from '../shared/terminal'

// Narrow capability surface (docs/electron.md §4g): expose only a desktop marker and the validated
// terminal channels (vNext §5) — never raw ipcRenderer.
contextBridge.exposeInMainWorld('acorn', {
  desktop: true,
  platform: process.platform,
  terminal: {
    list: () => ipcRenderer.invoke('term:list'),
    profiles: () => ipcRenderer.invoke('term:profiles'),
    create: (opts: CreateOpts) => ipcRenderer.invoke('term:create', opts),
    kill: (id: string) => ipcRenderer.invoke('term:kill', id),
    interrupt: (id: string) => ipcRenderer.invoke('term:interrupt', id),
    remove: (id: string) => ipcRenderer.invoke('term:remove', id),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.invoke('term:resize', { id, cols, rows }),
    repoPath: {
      get: (owner: string, repo: string) => ipcRenderer.invoke('term:repoPath:get', { owner, repo }),
      set: (owner: string, repo: string, path: string) => ipcRenderer.invoke('term:repoPath:set', { owner, repo, path }),
      // Native folder picker (onboarding / repo mapping). Returns the chosen absolute path or null.
      pick: () => ipcRenderer.invoke('term:repoPath:pick'),
      runConfig: (owner: string, repo: string, runCommand: string, devPort: number) =>
        ipcRenderer.invoke('term:repoPath:runConfig', { owner, repo, runCommand, devPort }),
    },
    // Resolve a workspace's browser-preview URL by running its configured script in the task's
    // worktree (script mode only — url/port are computed client-side). Returns the trimmed stdout.
    previewUrl: (taskId: string, script: string) => ipcRenderer.invoke('term:previewUrl', { taskId, script }),
    task: {
      // Guarded archive + worktree teardown (docs/workspaces 05). Lives on the terminal bridge
      // because teardown needs the main-process git + live session map.
      archive: (id: string, opts?: { deleteWorktree?: boolean; force?: boolean }) => ipcRenderer.invoke('term:task:archive', id, opts),
      // Notify main a task was created, so it can run the setup script now if configured to.
      onCreated: (id: string) => ipcRenderer.invoke('term:task:onCreated', id),
      // Live worktree statuses (dirty / missing) for the rail + footer markers.
      statuses: () => ipcRenderer.invoke('term:task:statuses'),
    },
    write: (id: string, data: string) => ipcRenderer.send('term:input', { id, data }),
    // Subscribe to session-status pings (idle/exit changes for any session); returns unsubscribe.
    onStatus: (cb: () => void) => {
      const listener = () => cb()
      ipcRenderer.on('term:status', listener)
      return () => ipcRenderer.removeListener('term:status', listener)
    },
    // Subscribe to one session's output; returns an unsubscribe. Detaching keeps the PTY running.
    attach: (id: string, on: (m: ServerMsg) => void) => {
      const listener = (_e: IpcRendererEvent, m: ServerMsg) => on(m)
      ipcRenderer.on(`term:out:${id}`, listener)
      ipcRenderer.send('term:attach', id)
      return () => {
        ipcRenderer.removeListener(`term:out:${id}`, listener)
        ipcRenderer.send('term:detach', id)
      }
    },
  },
  // Monaco editor pane: read/write files on the task's worktree. Separate bridge from `terminal`
  // (own IPC channels), though the handlers share the main-process git/worktree resolution.
  editor: {
    root: (taskId: string) => ipcRenderer.invoke('editor:root', taskId),
    list: (taskId: string, relPath: string) => ipcRenderer.invoke('editor:list', { taskId, relPath }),
    read: (taskId: string, relPath: string) => ipcRenderer.invoke('editor:read', { taskId, relPath }),
    write: (taskId: string, relPath: string, content: string) =>
      ipcRenderer.invoke('editor:write', { taskId, relPath, content }),
  },
})
