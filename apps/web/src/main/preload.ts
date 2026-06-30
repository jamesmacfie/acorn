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
      runConfig: (owner: string, repo: string, runCommand: string, devPort: number) =>
        ipcRenderer.invoke('term:repoPath:runConfig', { owner, repo, runCommand, devPort }),
    },
    workspace: {
      // Guarded archive + worktree teardown (docs/workspaces 05). Lives on the terminal bridge
      // because teardown needs the main-process git + live session map.
      archive: (id: string) => ipcRenderer.invoke('term:workspace:archive', id),
      // Live worktree statuses (dirty / missing) for the rail + footer markers.
      statuses: () => ipcRenderer.invoke('term:workspace:statuses'),
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
})
