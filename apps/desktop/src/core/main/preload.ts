import { contextBridge, ipcRenderer } from 'electron'
import type {
  PreviewFindDirection,
  PreviewFindRequested,
  PreviewFindResult,
  PreviewFindStopAction,
  PreviewNavigationCommand,
  PreviewState,
} from '../shared/preview'

// Narrow capability surface (docs/electron.md §4g): expose only a desktop marker and the validated
// terminal channels (docs/terminal-and-agents.md) — never raw ipcRenderer.
contextBridge.exposeInMainWorld('acorn', {
  desktop: true,
  platform: process.platform,
  // Cmd/Ctrl+W → close the focused pane (terminal tab / editor file), never the window. Main
  // suppresses the native accelerator and pings here; the pane that owns focus handles it.
  onClosePane: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on('acorn:close-pane', listener)
    return () => ipcRenderer.removeListener('acorn:close-pane', listener)
  },
  onWillQuit: (cb: () => boolean | Promise<boolean>) => {
    const listener = () => {
      void Promise.resolve(cb()).then((approved) => ipcRenderer.send('acorn:quit-response', approved)).catch(() => ipcRenderer.send('acorn:quit-response', false))
    }
    ipcRenderer.on('acorn:will-quit', listener)
    return () => ipcRenderer.removeListener('acorn:will-quit', listener)
  },
  // The terminal residue now: ONLY the native folder picker (dialog.showOpenDialog — a
  // true Electron capability, and the renderer's desktop-mode marker). Every request/response verb
  // is HTTP; every stream (PTY input/output/status, workflow notices) is the WebSocket (wsClient.ts).
  terminal: {
    repoPath: {
      // Native folder picker (onboarding / repo mapping). Returns the chosen absolute path or null.
      pick: () => ipcRenderer.invoke('term:repoPath:pick'),
    },
  },
  // Browser-preview surface (docs/panes.md): a main-owned WebContentsView per task. The
  // renderer drives lifecycle/chrome over IPC and positions the native view over the pane's host rect;
  // main pushes chrome state (loading, url, back/forward) back via onEvent. Agent CDP driving binds
  // inside main when the view is created, so no webContents id ever crosses this bridge.
  preview: {
    ensure: (taskId: string, url: string) => ipcRenderer.invoke('preview:ensure', { taskId, url }),
    setBounds: (taskId: string, rect: { x: number; y: number; width: number; height: number }) => ipcRenderer.send('preview:bounds', { taskId, rect }),
    show: (taskId: string) => ipcRenderer.send('preview:show', { taskId }),
    hide: () => ipcRenderer.send('preview:hide'),
    load: (taskId: string, url: string) => ipcRenderer.send('preview:load', { taskId, url }),
    command: (taskId: string, action: PreviewNavigationCommand) => ipcRenderer.send('preview:command', { taskId, action }),
    find: (taskId: string, text: string, direction: PreviewFindDirection) => ipcRenderer.send('preview:find', { taskId, text, direction }),
    stopFind: (taskId: string, action: PreviewFindStopAction) => ipcRenderer.send('preview:stop-find', { taskId, action }),
    focus: (taskId: string) => ipcRenderer.send('preview:focus', { taskId }),
    evict: (taskId: string) => ipcRenderer.send('preview:evict', { taskId }),
    onEvent: (cb: (s: PreviewState) => void) => {
      const listener = (_e: unknown, s: PreviewState) => cb(s)
      ipcRenderer.on('preview:event', listener)
      return () => ipcRenderer.removeListener('preview:event', listener)
    },
    onFindRequested: (cb: (request: PreviewFindRequested) => void) => {
      const listener = (_e: unknown, request: PreviewFindRequested) => cb(request)
      ipcRenderer.on('preview:find-requested', listener)
      return () => ipcRenderer.removeListener('preview:find-requested', listener)
    },
    onFindResult: (cb: (result: PreviewFindResult) => void) => {
      const listener = (_e: unknown, result: PreviewFindResult) => cb(result)
      ipcRenderer.on('preview:find-result', listener)
      return () => ipcRenderer.removeListener('preview:find-result', listener)
    },
  },
})
