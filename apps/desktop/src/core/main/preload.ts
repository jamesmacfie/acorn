import { contextBridge, ipcRenderer } from 'electron'

// Narrow capability surface (docs/electron.md §4g): expose only a desktop marker and the validated
// terminal channels (vNext §5) — never raw ipcRenderer.
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
  // The terminal residue after Phase 3: ONLY the native folder picker (dialog.showOpenDialog — a
  // true Electron capability, and the renderer's desktop-mode marker). Every request/response verb
  // is HTTP; every stream (PTY input/output/status, workflow notices) is the WebSocket (wsClient.ts).
  terminal: {
    repoPath: {
      // Native folder picker (onboarding / repo mapping). Returns the chosen absolute path or null.
      pick: () => ipcRenderer.invoke('term:repoPath:pick'),
    },
  },
  // Browser-preview surface (docs/panes.md, Phase 9 A): a main-owned WebContentsView per task. The
  // renderer drives lifecycle/chrome over IPC and positions the native view over the pane's host rect;
  // main pushes chrome state (loading, url, back/forward) back via onEvent. Agent CDP driving binds
  // inside main when the view is created, so no webContents id ever crosses this bridge.
  preview: {
    ensure: (taskId: string, url: string) => ipcRenderer.invoke('preview:ensure', { taskId, url }),
    setBounds: (taskId: string, rect: { x: number; y: number; width: number; height: number }) => ipcRenderer.send('preview:bounds', { taskId, rect }),
    show: (taskId: string) => ipcRenderer.send('preview:show', { taskId }),
    hide: () => ipcRenderer.send('preview:hide'),
    load: (taskId: string, url: string) => ipcRenderer.send('preview:load', { taskId, url }),
    command: (taskId: string, action: 'back' | 'forward' | 'reload' | 'stop') => ipcRenderer.send('preview:command', { taskId, action }),
    evict: (taskId: string) => ipcRenderer.send('preview:evict', { taskId }),
    onEvent: (cb: (s: { taskId: string; url: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }) => void) => {
      const listener = (_e: unknown, s: { taskId: string; url: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }) => cb(s)
      ipcRenderer.on('preview:event', listener)
      return () => ipcRenderer.removeListener('preview:event', listener)
    },
  },
})
