import { app, dialog, safeStorage, shell, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerPreviewIpc } from '@acorn/plugin-preview/main/index.ts'
import { registerFolderPickerIpc } from '@acorn/plugin-terminal/main/index.ts'
import type { ServiceStartResult } from '@acorn/protocol/serviceProtocol.ts'
import { registerDesktopCapabilityHandlers } from './desktopCapabilities'
import { createHelper } from './helper'
import { MAX_CRASHES_PER_WINDOW } from './helper/crashBudget'
import type { TokenCipher } from './helper/deviceTokenStore'
import { brokerPushTargets, registerNodeBrokerIpc } from './nodeBrokerIpc'
import { registerPluginIpc } from './pluginIpc'
import { registerPluginScheme } from './pluginScheme'
import { registerPluginWebviewIpc } from './pluginWebviewIpc'
import { WebviewService } from './webviewService'

export type BootstrapOptions = {
  dataDir: string
  createWindow: (started: ServiceStartResult) => Promise<BrowserWindow>
}

// Electron main's boot order and teardown (docs/electron.md § Main process). Everything that is not
// Electron — the broker, the fleet, the tokens, the plugin stores, the tunnels, and the supervised
// node — is composed by main/helper/, which knows nothing about windows or IPC. This file is the
// Electron half of that seam: it supplies the encryption, the push target, the recovery dialog, and
// the IPC projections the renderer talks to.

// safeStorage encrypts against the OS keychain and is built in, so docs/data-layer.md's "OS keychain"
// needs no keytar dependency. Same mechanism as sessionKeyStore.ts, but a second independent secret.
const safeStorageCipher: TokenCipher = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (value) => safeStorage.encryptString(value),
  decrypt: (blob) => safeStorage.decryptString(blob),
}

export async function bootstrap({ dataDir, createWindow }: BootstrapOptions): Promise<BrowserWindow> {
  let disposed = false
  let window: BrowserWindow | null = null
  const reloadWindow = (): void => {
    if (window && !window.isDestroyed()) window.webContents.reload()
  }
  const bundledPluginsDir = app.isPackaged
    ? join(process.resourcesPath, 'plugins')
    : join(import.meta.dirname, '../bundled-plugins')

  // Push targets are held as a function of the window rather than a captured reference, so a window
  // replaced by crash recovery gets the new one (nodeBrokerIpc.ts).
  const helper = createHelper({
    serviceEntry: join(import.meta.dirname, 'service.js'),
    service: {
      dataDir,
      version: app.getVersion(),
      isPackaged: app.isPackaged,
      electronPath: process.execPath,
      mcpEntry: join(import.meta.dirname, 'mcp.js'),
      bundledPluginsDir,
    },
    userDataDir: app.getPath('userData'),
    tokenCipher: safeStorageCipher,
    push: brokerPushTargets(() => window),
    desktopCapabilities: registerDesktopCapabilityHandlers,
    onNodeReplaced: reloadWindow,
    onCrashBudgetExhausted: () => void showRecoveryScreen(),
  })

  // Native IPC is installed before the renderer exists. Page rules cross the service boundary as
  // data; neither previewService nor the picker adapter can reach SQLite.
  const disposePicker = registerFolderPickerIpc()
  const disposeBrokerIpc = registerNodeBrokerIpc(helper.broker, helper.fleet, {
    restartLocalNode: () => helper.restartLocalNode(),
    tunnels: helper.tunnels,
  })
  const disposePluginIpc = registerPluginIpc(helper.pluginCache, helper.pluginTrust)
  // The origin plugin UI renders on (docs/plugins.md). Registered here rather than beside
  // registerAppScheme in electron.ts because it serves out of the plugin cache and nothing else: the
  // handler has no path parameter to be pointed at, by design.
  registerPluginScheme(helper.pluginCache)

  // Registered here rather than beside the picker above, because it needs the tunnels: a preview pane
  // pointed at a remote task loads a loopback URL, and the tunnel's listener refuses any connection
  // that does not present that listener's secret (helper/previewTunnel.ts). This is the injection that
  // carries it, since plugins/preview may not import an app, so the header record arrives as a
  // function. Still well before the window exists, the ordering the picker comment above is about.
  const webviews = new WebviewService()
  const disposePluginWebviews = registerPluginWebviewIpc(webviews)
  const disposePreview = registerPreviewIpc({
    viewService: webviews,
    rulesForTask: (taskId) => helper.previewRules(taskId),
    tunnelHeadersFor: (url) => helper.tunnels.headersFor(url),
  })

  const dispose = async (): Promise<void> => {
    if (disposed) return
    disposed = true
    await helper.dispose()
    disposeBrokerIpc()
    disposePluginIpc()
    disposePluginWebviews()
    disposePreview()
    disposePicker()
  }

  const showRecoveryScreen = async (): Promise<void> => {
    const { response } = await dialog.showMessageBox({
      type: 'error',
      message: 'The acorn background service keeps stopping',
      detail: `It restarted ${MAX_CRASHES_PER_WINDOW} times in ten minutes, so acorn stopped trying. Your data is untouched — acorn never creates a fresh data root to recover.`,
      buttons: ['Retry', 'Diagnostics', 'Open data folder', 'Quit'],
      defaultId: 0,
      cancelId: 3,
      noLink: true,
    })
    if (response === 1 || response === 2) {
      // Look-at-it actions: open the folder and ask again, rather than treating a diagnostic click as an
      // answer to "what should acorn do now".
      await shell.openPath(response === 1 ? join(dataDir, 'logs') : dataDir)
      return showRecoveryScreen()
    }
    if (response === 3) return void app.exit(1)
    await helper.retry()
  }

  app.on('will-quit', (event) => {
    if (disposed) return
    event.preventDefault()
    void dispose().finally(() => app.exit())
  })

  try {
    const started = await helper.start()
    window = await createWindow(started)
    helper.bootComplete()
    return window
  } catch (error) {
    await dispose()
    throw error
  }
}
