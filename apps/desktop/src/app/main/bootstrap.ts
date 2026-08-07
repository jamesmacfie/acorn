import { app, dialog, shell, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerPreviewIpc } from '@acorn/plugin-preview/main/previewService.ts'
import { registerRepoPickerIpc } from '@acorn/plugin-terminal/main/pickerIpc.ts'
import type { ServiceStartResult, ServiceState } from '@acorn/protocol/serviceProtocol.ts'
import { LOCAL_TOKEN_SCOPE, readDeviceToken } from './deviceTokenStore'
import { FleetStore, toNodeRecord } from './fleetStore'
import { NodeBroker } from './nodeBroker'
import { brokerPushTargets, registerNodeBrokerIpc } from './nodeBrokerIpc'
import { PreviewTunnels } from './previewTunnel'
import { ServiceHost } from './serviceHost'

export type BootstrapOptions = {
  dataDir: string
  createWindow: (started: ServiceStartResult) => Promise<BrowserWindow>
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// docs/architecture-overview.md § Failure behavior, literally: "Electron restarts it with backoff
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
    const started = await service.start(readDeviceToken(userDataDir, LOCAL_TOKEN_SCOPE))
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

  // The connection broker, likewise installed before the renderer: its first act on load is to ask
  // for the fleet, so the handler must already exist. Registering the IPC also reconnects every node
  // remembered from a previous launch — membership survives restarts, the local node included.
  const push = brokerPushTargets(() => window)
  const broker = new NodeBroker({ frame: push.frame, status: push.status })
  const fleet = new FleetStore(userDataDir)
  // Preview tunnels re-resolve their node from the same fleet store the broker reads on every connection,
  // so updated endpoint, token, and certificate records are applied to new connections. Established
  // pipes are torn down explicitly by restart, adoption, and forget operations.
  const tunnels = new PreviewTunnels((nodeId) => {
    const node = fleet.get(nodeId)
    const token = node && fleet.tokenFor(nodeId)
    if (!node || !token) return null
    return {
      endpoint: node.endpoint,
      token,
      ...(node.certPem ? { certPem: node.certPem } : {}),
      ...(node.fingerprint ? { fingerprint: node.fingerprint } : {}),
    }
  })
  const disposeBrokerIpc = registerNodeBrokerIpc(broker, fleet, { restartLocalNode: () => restartLocalNode(), tunnels })

  // Registered here rather than beside the picker above, because it needs `tunnels`: a preview pane
  // pointed at a remote task loads a loopback URL, and the tunnel's listener refuses any connection that
  // does not present that listener's secret (main/previewTunnel.ts). This is the injection that carries
  // it — plugins/preview may not import an app, so the header record arrives as a function. Still well
  // before the window exists, which is the ordering the picker comment above is about.
  const disposePreview = registerPreviewIpc({
    rulesForTask: (taskId) => service.previewRules(taskId),
    tunnelHeadersFor: (url) => tunnels.headersFor(url),
  })

  // Record (or re-record, after a crash restart) the local node and bring its connection up. The
  // endpoint, the certificate and even the token can change between starts now that the port is
  // ephemeral, so this is driven by each start result rather than cached — but the LABEL is the
  // owner's, so a rename survives.
  const adoptLocalNode = (started: ServiceStartResult): void => {
    // Every start — first boot, crash recovery, a deliberate restart — can change the endpoint, the
    // certificate and the token, so any surviving pipe to this node is pointed at a process that is gone.
    tunnels.closeFor({ nodeId: started.nodeId })
    const node = fleet.remember(
      {
        nodeId: started.nodeId,
        label: fleet.get(started.nodeId)?.label ?? 'This computer',
        endpoint: started.endpoint.origin,
        local: true,
        ...(started.fingerprint ? { fingerprint: started.fingerprint } : {}),
        ...(started.certPem ? { certPem: started.certPem } : {}),
      },
      started.deviceToken,
    )
    broker.upsert({
      ...toNodeRecord(node),
      token: started.deviceToken,
      ...(node.certPem ? { certPem: node.certPem } : {}),
    })
  }

  // Settings → Plugins' Restart button (nodeBrokerIpc.ts explains why only the local node has one).
  //
  // It goes through the same `startService` as boot and crash recovery, so the node re-reads its
  // disabled-plugins file on the way up and `adoptLocalNode` re-records the endpoint, certificate and
  // token — all three can change across a restart now that the port is ephemeral. Not routed through
  // `recover()`, deliberately: this is a deliberate restart, and spending one of the five crashes in the
  // ten-minute budget on it would mean a few plugin toggles could trip the recovery screen.
  // Guarded against `recover()`, which is the case that made this dangerous rather than merely racy.
  //
  // `ServiceHost.start` throws "already started" while a child exists. So without the guard: the service
  // crashes, `recover()` is inside its backoff `wait`, the owner clicks Restart, Restart succeeds — and
  // then `recover()`'s own `startService()` throws, its catch calls `service.stop()` and KILLS the working
  // node, then re-enters `recover()` and spends another crash from the budget. Two clicks during recovery
  // tripped the recovery dialog on a healthy node.
  //
  // A failure here also has to reach `recover()`, not just the renderer: if `startService()` rejects (a
  // taken port, a corrupt plugin DB) no child was ever spawned, so `unexpectedExit` never fires and the app
  // would sit with a dead node until relaunch. It still reports to the caller, so Settings → Plugins shows
  // the reason.
  const restartLocalNode = async (): Promise<void> => {
    if (disposed) return
    if (recovering) throw new Error('acorn is already restarting the background service.')
    recovering = true
    // A pipe to the process we are about to kill is dead either way, and its endpoint is about to change.
    tunnels.closeFor({})
    try {
      await service.stop()
      await startService()
      if (window && !window.isDestroyed()) window.webContents.reload()
    } catch (error) {
      recovering = false
      void recover()
      throw error
    }
    recovering = false
  }

  const dispose = async (): Promise<void> => {
    if (disposed) return
    disposed = true
    await service.stop()
    tunnels.dispose()
    broker.dispose()
    disposeBrokerIpc()
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
