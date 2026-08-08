import { dialog, ipcMain } from 'electron'

// The terminal/worktree engine is service-process code. This is its one genuinely Electron-owned
// capability: choosing a local checkout through the native folder picker. Keep it in main and expose
// only the existing narrow preload channel; the selected path is still validated and persisted by
// the service's HTTP route.
export function registerFolderPickerIpc(): () => void {
  const pick = async (): Promise<string | null> => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0]
  }

  ipcMain.handle('term:folderPath:pick', pick)
  return () => ipcMain.removeHandler('term:folderPath:pick')
}
