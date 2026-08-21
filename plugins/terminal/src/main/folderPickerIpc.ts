import { createRequire } from 'node:module'

// The terminal/worktree engine is service-process code. This is its one genuinely Electron-owned
// capability: choosing a local checkout through the native folder picker. Kept in main/, behind the
// existing narrow preload channel; the selected path is still validated and persisted by the
// service's HTTP route.
//
// `electron` resolves lazily, at call time, not at import (docs/plugins.md § Package shape).
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
