// Electron composition root. Its responsibilities are intentionally narrow:
// native UI adapters, utility-process supervision, window timing, and ordered shutdown.
// The Node application runtime (DB, Hono/WS, PTYs, Git/process work, workflows) is composed in
// app/service/runtime.ts and cannot stall Electron's main event loop.
import { app, dialog, shell, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerPreviewIpc } from '@acorn/plugin-preview/main/previewService.ts'
import { registerRepoPickerIpc } from '@acorn/plugin-terminal/main/pickerIpc.ts'
import type { ServiceStartResult, ServiceState } from '@acorn/protocol/serviceProtocol.ts'
import { readLocalDeviceToken, writeLocalDeviceToken } from './deviceTokenStore'
import { NodeBroker } from './nodeBroker'
import { brokerPushTargets, registerNodeBrokerIpc } from './nodeBrokerIpc'
import { ServiceHost } from './serviceHost'

export type BootstrapOptions = {
  dataDir: string
  createWindow: (started: ServiceStartResult) => Promise<BrowserWindow>
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// docs/vNext/architecture.md § Failure behavior, literally: "Electron restarts it with backoff
// (1/2/4/8/16s, max 5 in 10 min), then shows a recovery screen". The previous policy was
// 250·2^(n-1) ms with a >3-in-60s ceiling — much tighter, and tight enough that a service crashing on
// something durable (a corrupt database, a port it can never bind) burned its budget in under two
// seconds and quit before a human could read anything.
const CRASH_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000]
const CRASH_WINDOW_MS = 10 * 60_000
const MAX_CRASHES_PER_WINDOW = 5

export async function bootstrap({ dataDir, createWindow }: BootstrapOptions): Promise<BrowserWindow> {
  let disposed = false
  let bootComplete = false
  let recovering = false
  let window: BrowserWindow | null = null
  const crashTimes: number[] = []
  const userDataDir = app.getPath('userData')

  // Start the service and persist whatever token it ended up using. Reused on every start, including
  // crash recovery — a restart must not mint a new device row, and the endpoint can change across
  // restarts, so the caller always takes the fresh result rather than caching the first one.
  const startService = async (): Promise<ServiceStartResult> => {
    const started = await service.start(readLocalDeviceToken(userDataDir))
    writeLocalDeviceToken(userDataDir, started.deviceToken)
    adoptLocalNode(started)
    return started
  }

  const service = new ServiceHost(
    join(import.meta.dirname, 'service.js'),
    {
      dataDir,
      version: app.getVersion(),
      isPackaged: app.isPackaged,
      electronPath: process.execPath,
      mcpEntry: join(import.meta.dirname, 'mcp.js'),
    },
    {
      stateChanged: (state: ServiceState, detail?: string) => {
        console.log(`[service-host] ${state}${detail ? `: ${detail}` : ''}`)
      },
      unexpectedExit: (code) => {
        if (!bootComplete || disposed) return
        console.error(`[service-host] service exited unexpectedly with code ${code}`)
        void recover()
      },
    },
  )

  // Native IPC is installed before the renderer exists. Page rules cross the service boundary as
  // data; neither previewService nor the picker adapter can reach SQLite.
  const disposePicker = registerRepoPickerIpc()
  const disposePreview = registerPreviewIpc((taskId) => service.previewRules(taskId))

  // The connection broker, likewise installed before the renderer: its first act on load is to ask
  // for the fleet, so the handler must already exist.
  const push = brokerPushTargets(() => window)
  const broker = new NodeBroker({ frame: push.frame, status: push.status })
  const disposeBrokerIpc = registerNodeBrokerIpc(broker)

  // Register (or re-register, after a crash restart) the local node. The endpoint can change between
  // starts now that the port is not pinned, so this is driven by each start result rather than cached.
  const adoptLocalNode = (started: ServiceStartResult): void => {
    broker.upsert({
      nodeId: started.nodeId,
      label: 'This computer',
      endpoint: started.endpoint.origin,
      local: true,
      token: started.deviceToken,
      ...(started.fingerprint ? { fingerprint: started.fingerprint } : {}),
      ...(started.certPem ? { certPem: started.certPem } : {}),
    })
  }

  const dispose = async (): Promise<void> => {
    if (disposed) return
    disposed = true
    await service.stop()
    broker.dispose()
    disposeBrokerIpc()
    disposePreview()
    disposePicker()
  }

  // The recovery screen architecture.md asks for, with its four affordances exactly: Retry /
  // Diagnostics / Open data folder / Quit. A native dialog rather than a page, because this is the case
  // where there may be NO window to render into — the renderer's own recovery screen
  // (client-core/node/NodeGate.tsx) covers the case where there is one, and it cannot cover this one.
  // ponytail: the designed screen is Phase 4 UI work; four buttons wired to four actions is the whole
  // behavioural contract, and it needs zero HTML and zero renderer changes.
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
    // Retry: clear the budget so the next failure gets the full backoff again. The owner asking for a
    // retry is new information — they may have just freed the port or fixed permissions.
    crashTimes.length = 0
    recovering = false
    await recover()
  }

  const recover = async (): Promise<void> => {
    if (recovering || disposed) return
    recovering = true
    const now = Date.now()
    crashTimes.push(now)
    while (crashTimes[0] != null && crashTimes[0] < now - CRASH_WINDOW_MS) crashTimes.shift()
    if (crashTimes.length > MAX_CRASHES_PER_WINDOW) {
      await showRecoveryScreen()
      return
    }
    try {
      await wait(CRASH_BACKOFF_MS[Math.min(crashTimes.length - 1, CRASH_BACKOFF_MS.length - 1)]!)
      await startService()
      if (window && !window.isDestroyed()) window.webContents.reload()
      console.log('[service-host] background service recovered')
    } catch (error) {
      console.error('[service-host] recovery failed:', error)
      await service.stop()
      recovering = false
      void recover()
      return
    }
    recovering = false
  }

  app.on('will-quit', (event) => {
    if (disposed) return
    event.preventDefault()
    void dispose().finally(() => app.exit())
  })

  try {
    // The service start request resolves when migrations, bridge installation, and the loopback
    // listener are complete. Durable reconciliation continues there in the background.
    const started = await startService()
    window = await createWindow(started)
    bootComplete = true
    return window
  } catch (error) {
    await dispose()
    throw error
  }
}
