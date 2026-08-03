import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import { join, resolve } from 'node:path'
import { APP_ORIGIN, registerAppScheme } from './appScheme'
import { bootstrap } from './bootstrap'
import { resolveSessionKey } from './sessionKeyStore'
import { devDataDir } from '@acorn/node-core/main/serverConfig.ts'
import { isAllowedExternalUrl } from '@acorn/node-core/main/urlGuards.ts'

const PRELOAD = join(import.meta.dirname, '../preload/index.cjs')

// Must run at module scope, BEFORE app.whenReady(): Chromium reads the privileged-scheme table while
// it initialises, and registering later is a silent no-op. Every privilege here earns its place:
//   standard          hierarchical URLs — what makes base:'/', history.pushState and @solidjs/router's
//                     path routes work at all. Without it every route is an opaque path.
//   secure            treats the origin as a secure context: IndexedDB (the persisted query cache),
//                     crypto.subtle, clipboard.
//   supportFetchAPI   fetch()/module scripts over the scheme — the renderer is ESM, and Monaco loads
//                     its five ?worker chunks this way.
//   stream            lets the handler answer with net.fetch's streamed body instead of buffering.
//   codeCache         V8 code cache across launches, which is most of the startup win.
// Deliberately NOT corsEnabled (nothing the renderer touches is cross-origin — node traffic is IPC)
// and NOT allowServiceWorkers (there is no offline story here, and no worker may cache the shell).
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
])

// Writable app-data root (DB, blobs, worktrees, notes). Packaged builds must not write next to the
// module (that's the read-only asar) — use the OS-standard userData dir. Dev keeps the repo-local
// apps/node/.acorn so a checkout's data stays with the checkout; it belongs to apps/node because the
// node owns SQLite, blobs and the node identity (node-core/main/serverPaths.ts).
const e2e = process.env.ACORN_E2E === '1'
const dataDir = e2e && process.env.ACORN_E2E_DATA_DIR
  ? resolve(process.env.ACORN_E2E_DATA_DIR)
  : app.isPackaged ? app.getPath('userData') : devDataDir()

// Dev: load secrets from .env. Packaged builds have no bundled .env (that load no-ops); instead a
// user-provided .env in the data dir (~/Library/Application Support/acorn/.env) supplies
// GITHUB_CLIENT_* until their keychain path lands. SESSION_ENC_KEY falls through to safeStorage
// (resolveSessionKey, in whenReady below) either way.
for (const envFile of [join(import.meta.dirname, '../../.env'), join(dataDir, '.env')]) {
  try {
    process.loadEnvFile(envFile)
  } catch {
    // no .env at this location — secrets must come from the other file / environment / keychain
  }
}
// Release builds bake the GitHub OAuth app credentials in at build time (MAIN_VITE_* env vars in
// CI, statically replaced by vite). Anything set via .env / the environment above wins.
process.env.GITHUB_CLIENT_ID ??= import.meta.env.MAIN_VITE_GITHUB_CLIENT_ID
process.env.GITHUB_CLIENT_SECRET ??= import.meta.env.MAIN_VITE_GITHUB_CLIENT_SECRET

// Single-instance: a second launch focuses the existing window. The data root's exclusive lock
// (node-core/main/dataRoot.ts) is the real mutual exclusion; this keeps a second launch from getting
// as far as fighting over it.
if (!app.requestSingleInstanceLock()) app.quit()

let mainWindow: BrowserWindow | null = null
// Whether the service has started and the broker has adopted the local node. The window used to need
// the endpoint too; it loads from the app scheme now, so all a Dock-activate has to know is "is there
// a node to talk to yet".
let serviceReady = false
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

// The node recovery screen's two native actions (client-core/node/NodeGate.tsx). `force-quit` skips
// the renderer will-quit prompt on purpose: that prompt is answered by the app shell, which is not
// mounted when the gate is showing, so routing through it would hang.
ipcMain.on('acorn:open-data-folder', () => void shell.openPath(dataDir))
ipcMain.on('acorn:force-quit', () => {
  quitApproved = true
  app.quit()
})

// There is deliberately NO app.on('certificate-error') handler for the node's self-signed certificate.
// That event only fires for requests Chromium makes, and nothing in this process asks Chromium to talk
// to a node: the window loads app://acorn, and every byte to or from a node goes through the broker's
// own node:https agent, which does the pinning itself (main/nodeBroker.ts). Adding one "just in case"
// would install a certificate-override path for a trust decision that is made somewhere else entirely.

function hardenNavigation(win: BrowserWindow) {
  // Anything leaving the renderer for the OS goes through the scheme allowlist first: the pane
  // content that produces these links (GitHub bodies, Linear issues/attachments, Rollbar) is
  // third-party, so a `file:`/custom-scheme href would otherwise be an arbitrary-app launch.
  const openExternal = (url: string): void => {
    if (!isAllowedExternalUrl(url)) return void console.warn('[electron] blocked external open:', url)
    void shell.openExternal(url)
  }

  // The main window may only ever sit on the bundled app origin; everything else opens in the system
  // browser. There is no longer an OAuth exception: GitHub is connected by device flow against the node
  // (POST /v2/p/github/auth/device/start), so no window of ours ever has to visit github.com.
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(APP_ORIGIN)) return
    e.preventDefault()
    openExternal(url)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  // The browser-preview pane is now a main-owned WebContentsView (previewService.ts), not
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
  // The renderer comes from the app scheme, not from a node. Nothing about the window depends on where
  // the service bound any more — that endpoint is the broker's business (main/nodeBroker.ts).
  await win.loadURL(`${APP_ORIGIN}/`)
  return win
}

app.whenReady().then(async () => {
  // One call into the composition root: it migrates, constructs services, installs bridges, starts
  // the loopback listener, then creates the window (main/bootstrap.ts owns the order + teardown).
  try {
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
    // Boot is all-or-nothing: a failure here (migration, a data root already locked, …) means no node
    // to talk to — surface it and quit rather than sit headless in the dock forever (this macOS build
    // has no window-all-closed quit).
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
  // serviceReady ⇒ bootstrap finished and the broker has adopted the local node. Before that a
  // Dock-click window would render NodeGate's recovery screen against an empty fleet — and bootstrap is
  // about to create its own window anyway.
  if (serviceReady && mainWindow && BrowserWindow.getAllWindows().length === 0) {
    void createMainWindow().then((w) => (mainWindow = w))
  }
})

// macOS-only build; standard behavior is to stay alive until Cmd-Q (no window-all-closed quit).
