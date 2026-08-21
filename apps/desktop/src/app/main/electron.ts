import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import { join, resolve } from 'node:path'
import { APP_ORIGIN, registerAppScheme } from './appScheme'
import { bootstrap } from './bootstrap'
import { PLUGIN_SCHEME } from './pluginScheme'
import { resolveSessionKey } from './sessionKeyStore'
import { devDataDir } from '@acorn/node-core/main/serverConfig.ts'
import { isAllowedExternalUrl } from '@acorn/node-core/main/urlGuards.ts'

const PRELOAD = join(import.meta.dirname, '../preload/index.cjs')

// Both schemes register here, at module scope and before app.whenReady(), because Chromium reads
// the privileged-scheme table during its own startup, and registering later is a silent no-op.
// docs/electron.md § Main process has what each privilege buys and why app:// and app-plugin://
// differ.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
  { scheme: PLUGIN_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

// Data directory selection: docs/electron.md § Startup: data directory, environment, and the
// singleton lock.
const e2e = process.env.ACORN_E2E === '1'
const dataDir = e2e && process.env.ACORN_E2E_DATA_DIR
  ? resolve(process.env.ACORN_E2E_DATA_DIR)
  : app.isPackaged ? app.getPath('userData') : devDataDir()

// .env load order and the SESSION_ENC_KEY fallback: docs/electron.md § Startup: data directory,
// environment, and the singleton lock.
for (const envFile of [join(import.meta.dirname, '../../.env'), join(dataDir, '.env')]) {
  try {
    process.loadEnvFile(envFile)
  } catch {
    // Fine if this file is missing: secrets can still come from the other file, the environment, or the keychain.
  }
}
// Single-instance lock: docs/electron.md § Startup: data directory, environment, and the singleton
// lock.
if (!app.requestSingleInstanceLock()) app.quit()

let mainWindow: BrowserWindow | null = null
let serviceReady = false
let quitApproved = false
let quitPromptPending = false

// Quit negotiation with the renderer: docs/electron.md § Startup: data directory, environment, and
// the singleton lock.
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

// NodeGate's two native actions, and why force-quit skips the renderer prompt: docs/electron.md
// § Startup: data directory, environment, and the singleton lock.
ipcMain.on('acorn:open-data-folder', () => void shell.openPath(dataDir))
ipcMain.on('acorn:force-quit', () => {
  quitApproved = true
  app.quit()
})

// No certificate-error handler here: docs/electron.md § Connection broker.

function hardenNavigation(win: BrowserWindow) {
  // Scheme allowlist for external opens: docs/security.md § Process, path, and configuration
  // controls. The links reaching this path come from third-party content (GitHub bodies, Linear
  // issues and attachments, Rollbar), so an unfiltered `file:` or custom-scheme href would be an
  // arbitrary-app launch.
  const openExternal = (url: string): void => {
    if (!isAllowedExternalUrl(url)) return void console.warn('[electron] blocked external open:', url)
    void shell.openExternal(url)
  }

  // Main-frame navigation policy, and why there is no OAuth exception: docs/electron.md
  // § The plugin frame origin.
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(APP_ORIGIN)) return
    e.preventDefault()
    openExternal(url)
  })
  // Subframe navigation policy: docs/electron.md § The plugin frame origin.
  win.webContents.on('will-frame-navigate', (e) => {
    if (e.frame === win.webContents.mainFrame) return // handled by will-navigate, which runs too
    if (e.url.startsWith(`${PLUGIN_SCHEME}://`)) return
    e.preventDefault()
    console.warn('[electron] blocked subframe navigation:', e.url)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    // window.open denial, plugin frames included: docs/electron.md § The plugin frame origin.
    openExternal(url)
    return { action: 'deny' }
  })
  // Preview's navigation guard lives on its own WebContentsView, not here: docs/electron.md
  // § Host-owned webviews.
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
  // Cmd/Ctrl+W closes the focused pane (a terminal tab or editor file), not the window. Main
  // intercepts it because a menu accelerator can't be suppressed from the page, only by preventing
  // before-input-event. The renderer decides what counts as the focused pane; if none owns focus,
  // nothing closes, since this is a single-window app and Cmd-Q is what quits it.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    if (input.key.toLowerCase() === 'w' && (input.meta || input.control) && !input.alt && !input.shift) {
      e.preventDefault()
      win.webContents.send('acorn:close-pane')
    }
  })
  // Under e2e the window must still be visible, since Playwright drives a real renderer, but it must
  // not steal focus mid-run: showInactive leaves whatever the developer was doing on top.
  win.once('ready-to-show', () => (e2e ? win.showInactive() : win.show()))
  // The renderer always loads from the app scheme, independent of where the node bound:
  // docs/electron.md § Renderer origin and protocol handler.
  await win.loadURL(`${APP_ORIGIN}/`)
  return win
}

app.whenReady().then(async () => {
  // bootstrap.ts owns the boot order and teardown: docs/electron.md § Main process.
  try {
    // An accessory app can't become the active app on macOS, so an e2e run never takes the
    // foreground and shows no dock icon. CDP input still reaches the renderer, so the specs are
    // unaffected.
    if (e2e && process.platform === 'darwin') app.setActivationPolicy('accessory')
    resolveSessionKey(dataDir) // safeStorage-backed SESSION_ENC_KEY before any binding reads it
    registerAppScheme() // protocol.handle must wait for ready; registerSchemesAsPrivileged could not
    mainWindow = await bootstrap({
      dataDir,
      createWindow: async () => {
        serviceReady = true
        return createMainWindow()
      },
    })
  } catch (e) {
    // Boot is all-or-nothing. A failure here (a migration error, a data root already locked) means
    // there is no node to talk to, so this shows the error and quits rather than sitting headless in
    // the dock (this macOS build has no window-all-closed quit).
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
  // serviceReady means bootstrap finished and the broker adopted the local node. Before that, a
  // dock-click window would render NodeGate's recovery screen against an empty fleet, and bootstrap
  // is about to create its own window anyway.
  if (serviceReady && mainWindow && BrowserWindow.getAllWindows().length === 0) {
    void createMainWindow().then((w) => (mainWindow = w))
  }
})

// macOS-only build. No window-all-closed handler: the standard behavior is to stay running until Cmd-Q.
