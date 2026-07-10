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
  // The terminal residue after Phase 3: ONLY the native folder picker (dialog.showOpenDialog — a
  // true Electron capability, and the renderer's desktop-mode marker). Every request/response verb
  // is HTTP; every stream (PTY input/output/status, workflow notices) is the WebSocket (wsClient.ts).
  terminal: {
    repoPath: {
      // Native folder picker (onboarding / repo mapping). Returns the chosen absolute path or null.
      pick: () => ipcRenderer.invoke('term:repoPath:pick'),
    },
  },
  // Drivable browser (docs/panes.md): bind the task's preview webview so main can drive it via CDP.
  // A raw webContents id → capability handle, so it stays IPC (never HTTP).
  browser: {
    bind: (taskId: string, webContentsId: number) => ipcRenderer.invoke('browser:bind', { taskId, webContentsId }),
  },
})
