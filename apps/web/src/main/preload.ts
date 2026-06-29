import { contextBridge } from 'electron'

// Narrow capability surface (docs/electron.md §4g): expose only a desktop marker, never raw
// ipcRenderer. The v2 terminal feature will add explicit, payload-validated channels here.
contextBridge.exposeInMainWorld('acorn', {
  desktop: true,
  platform: process.platform,
})
