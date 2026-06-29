import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { ACORN_PORT, startServer } from './server'

const ORIGIN = `http://127.0.0.1:${ACORN_PORT}`
const PRELOAD = join(import.meta.dirname, '../preload/index.cjs')

// Dev: load secrets from .env. Packaged builds have no .env (this no-ops) and will read from the
// OS keychain — see docs/electron.md §4b/Phase 3.
try {
  process.loadEnvFile(join(import.meta.dirname, '../../.env'))
} catch {
  // no .env present — secrets must already be in the environment / keychain
}

// Single-instance: a second launch focuses the existing window. A pinned port means only one
// process can own the app origin (docs/electron.md §9) — fail fast rather than fight over it.
if (!app.requestSingleInstanceLock()) app.quit()

let mainWindow: BrowserWindow | null = null

// The renderer logs in by navigating to /auth/login, which 302s to github.com. The main window
// is locked to the loopback origin, so we intercept that and run the whole OAuth dance in a
// dedicated window that *is* allowed to visit GitHub (docs/electron.md §4f), then refresh.
function openAuthWindow(parent: BrowserWindow, loginUrl: string) {
  const authWin = new BrowserWindow({
    parent,
    modal: true,
    width: 520,
    height: 720,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }, // no preload
  })
  // After GitHub redirects back to the loopback /auth/callback, the server sets the session cookie
  // and redirects to an app route. Landing on a non-/auth loopback URL means login finished.
  authWin.webContents.on('did-navigate', (_e, url) => {
    if (url.startsWith(ORIGIN) && !url.includes('/auth/')) {
      authWin.close()
      parent.webContents.reload() // re-runs /api/me with the new cookie
    }
  })
  void authWin.loadURL(loginUrl)
}

function hardenNavigation(win: BrowserWindow) {
  // The main window may only ever sit on the loopback origin. External links open in the system
  // browser; a /auth/login navigation is rerouted into the OAuth window above.
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(ORIGIN)) {
      if (url.includes('/auth/login')) {
        e.preventDefault()
        openAuthWindow(win, url)
      }
      return
    }
    e.preventDefault()
    void shell.openExternal(url)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
}

async function createMainWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#121212',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  hardenNavigation(win)
  win.once('ready-to-show', () => win.show())
  await win.loadURL(ORIGIN)
  return win
}

app.whenReady().then(async () => {
  await startServer() // resolves once listening on the pinned loopback port
  mainWindow = await createMainWindow()
})

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createMainWindow().then((w) => (mainWindow = w))
})

// macOS-only build; standard behavior is to stay alive until Cmd-Q (no window-all-closed quit).
