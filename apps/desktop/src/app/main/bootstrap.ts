// Electron composition root. Its responsibilities are intentionally narrow:
// native UI adapters, utility-process supervision, window timing, and ordered shutdown.
// The Node application runtime (DB, Hono/WS, PTYs, Git/process work, workflows) is composed in
// app/service/runtime.ts and cannot stall Electron's main event loop.
import { app, dialog, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerPreviewIpc } from '@acorn/plugin-preview/main/previewService.ts'
import { registerRepoPickerIpc } from '@acorn/plugin-terminal/main/pickerIpc.ts'
import type { ServiceState } from '@acorn/protocol/serviceProtocol.ts'
import { ServiceHost } from './serviceHost'

export type BootstrapOptions = {
  dataDir: string
  origin: string
  createWindow: () => Promise<BrowserWindow>
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export async function bootstrap({ dataDir, origin, createWindow }: BootstrapOptions): Promise<BrowserWindow> {
  let disposed = false
  let bootComplete = false
  let recovering = false
  let window: BrowserWindow | null = null
  const crashTimes: number[] = []

  const service = new ServiceHost(
    join(import.meta.dirname, 'service.js'),
    {
      dataDir,
      clientDir: join(import.meta.dirname, '../../dist/client'),
      origin,
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

  const dispose = async (): Promise<void> => {
    if (disposed) return
    disposed = true
    await service.stop()
    disposePreview()
    disposePicker()
  }

  const recover = async (): Promise<void> => {
    if (recovering || disposed) return
    recovering = true
    const now = Date.now()
    crashTimes.push(now)
    while (crashTimes[0] != null && crashTimes[0] < now - 60_000) crashTimes.shift()
    if (crashTimes.length > 3) {
      dialog.showErrorBox(
        'acorn service stopped',
        'The background service exited repeatedly. acorn will close to avoid a restart loop.',
      )
      app.exit(1)
      return
    }
    try {
      await wait(250 * (2 ** (crashTimes.length - 1)))
      await service.start()
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
    await service.start()
    window = await createWindow()
    bootComplete = true
    return window
  } catch (error) {
    await dispose()
    throw error
  }
}
