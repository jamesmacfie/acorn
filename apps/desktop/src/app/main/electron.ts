import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { bootstrap } from './bootstrap'
import { resolveSessionKey } from '../../core/main/sessionKeyStore'
import { ACORN_PORT, devDataDir } from '../../core/main/server'

const ORIGIN = `http://127.0.0.1:${ACORN_PORT}`
const PRELOAD = join(import.meta.dirname, '../preload/index.cjs')

// Writable app-data root (DB, blobs, worktrees, notes). Packaged builds must not write next to the
// module (that's the read-only asar) — use the OS-standard userData dir. Dev keeps the repo-local
// apps/desktop/.acorn so a checkout's data stays with the checkout.
const dataDir = app.isPackaged ? app.getPath('userData') : devDataDir

// Dev: load secrets from .env. Packaged builds have no .env (this no-ops); SESSION_ENC_KEY then
// falls through to safeStorage (resolveSessionKey, in whenReady below). GITHUB_CLIENT_* still need
// to be present in the environment for a packaged build until their keychain path lands.
try {
  process.loadEnvFile(join(import.meta.dirname, '../../.env'))
} catch {
  // no .env present — secrets must already be in the environment / keychain
}

// Single-instance: a second launch focuses the existing window. A pinned port means only one
// process can own the app origin (docs/electron.md §9) — fail fast rather than fight over it.
if (!app.requestSingleInstanceLock()) app.quit()

let mainWindow: BrowserWindow | null = null
let quitApproved = false
let quitPromptPending = false

// Renderer will-phase: Cmd-Q asks the client event service to collect concerns, then replies. Once
// approved, app.quit() re-enters with the guard open and bootstrap's ordered will-quit disposal runs.
app.on('before-quit', (event) => {
  if (quitApproved) return
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  event.preventDefault()
  if (quitPromptPending) return
  quitPromptPending = true
  win.webContents.send('acorn:will-quit')
})
ipcMain.on('acorn:quit-response', (_event, approved: boolean) => {
  quitPromptPending = false
  if (!approved) return
  quitApproved = true
  app.quit()
})

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
  // The browser-preview pane is now a main-owned WebContentsView (previewService.ts, Phase 9 A), not
  // a <webview> guest — its http(s)-only navigation guard lives per-view there, so no
  // will-attach-webview handler here anymore.
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
  // Cmd/Ctrl+W closes the FOCUSED pane (terminal tab / editor file), not the whole window. We
  // intercept in main because a menu accelerator can't be suppressed from the page — preventing
  // before-input-event disables it (Electron docs). The renderer decides what "focused pane" is;
  // if none owns focus, nothing closes (this is a single-window app — Cmd-Q quits).
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    if (input.key.toLowerCase() === 'w' && (input.meta || input.control) && !input.alt && !input.shift) {
      e.preventDefault()
      win.webContents.send('acorn:close-pane')
    }
  })
  win.once('ready-to-show', () => win.show())
  await win.loadURL(ORIGIN)
  return win
}

app.whenReady().then(async () => {
  // One call into the composition root: it migrates, constructs services, installs bridges, starts
  // the loopback listener, then creates the window (main/bootstrap.ts owns the order + teardown).
  try {
    resolveSessionKey(dataDir) // safeStorage-backed SESSION_ENC_KEY (Phase 9 C) before any binding reads it
    mainWindow = await bootstrap({ dataDir, origin: ORIGIN, createWindow: createMainWindow })
  } catch (e) {
    // Boot is all-or-nothing: a failure here (migration, EADDRINUSE on the pinned port, …) means no
    // origin to load — surface it and quit rather than sit headless in the dock forever (this
    // macOS build has no window-all-closed quit).
    dialog.showErrorBox('acorn failed to start', e instanceof Error ? (e.stack ?? e.message) : String(e))
    app.quit()
  }
})

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('activate', () => {
  // mainWindow set ⇒ bootstrap finished (listener up). Before that, a Dock-click window would
  // loadURL an origin nothing is serving yet — and bootstrap is about to create its own window.
  if (mainWindow && BrowserWindow.getAllWindows().length === 0) void createMainWindow().then((w) => (mainWindow = w))
})

// macOS-only build; standard behavior is to stay alive until Cmd-Q (no window-all-closed quit).
