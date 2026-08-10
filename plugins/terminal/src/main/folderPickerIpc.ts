import { createRequire } from 'node:module'

// The terminal/worktree engine is service-process code. This is its one genuinely Electron-owned
// capability: choosing a local checkout through the native folder picker. Keep it in main and expose
// only the existing narrow preload channel; the selected path is still validated and persisted by
// the service's HTTP route.
//
// `electron` is resolved when this is CALLED, not when the module is imported. It used to be a static
// `import { dialog, ipcMain } from 'electron'`, and because main/index.ts re-exports this — while
// apps/node's composition root imports `reconcileTmux` from that same barrel, and a barrel evaluates
// every module on it — the standalone node died at boot with "The requested module 'electron' does
// not provide an export named 'dialog'". A composition root that runs outside Electron must be able
// to LOAD this file; only calling it needs a desktop.
const electron = () => createRequire(import.meta.url)('electron') as typeof import('electron')

export function registerFolderPickerIpc(): () => void {
  const { dialog, ipcMain } = electron()
  const pick = async (): Promise<string | null> => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0]
  }

  ipcMain.handle('term:folderPath:pick', pick)
  return () => ipcMain.removeHandler('term:folderPath:pick')
}
