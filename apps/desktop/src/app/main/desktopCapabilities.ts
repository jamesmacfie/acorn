import { z } from 'zod'
import type { ServiceRpcPeer } from '@acorn/protocol/serviceProtocol.ts'
import { driverFor } from '@acorn/plugin-preview/main/browserService.ts'
import {
  previewCurrentUrl,
  previewEvictTask,
  previewLoadUrl,
  previewNavigate,
  previewNavState,
} from '@acorn/plugin-preview/main/previewService.ts'

const taskPayload = z.strictObject({ taskId: z.string().min(1) })
const previewLoadPayload = taskPayload.extend({ url: z.string() })
const previewNavigatePayload = taskPayload.extend({
  action: z.enum(['back', 'forward', 'reload', 'stop']),
})
const browserClickPayload = taskPayload.extend({ ref: z.string() })
const browserFillPayload = browserClickPayload.extend({ text: z.string() })

// Main-process half of the native capability boundary. Keep validation here: utility-process
// messages are an IPC trust boundary even though both processes ship in the same application.
export function registerDesktopCapabilityHandlers(peer: ServiceRpcPeer): () => void {
  const disposers = [
    peer.register('desktop.preview-current-url', (payload) => previewCurrentUrl(taskPayload.parse(payload).taskId)),
    peer.register('desktop.preview-load-url', (payload) => {
      const { taskId, url } = previewLoadPayload.parse(payload)
      return previewLoadUrl(taskId, url)
    }),
    peer.register('desktop.preview-nav-state', (payload) => previewNavState(taskPayload.parse(payload).taskId)),
    peer.register('desktop.preview-navigate', (payload) => {
      const { taskId, action } = previewNavigatePayload.parse(payload)
      return previewNavigate(taskId, action)
    }),
    peer.register('desktop.preview-evict', (payload) => previewEvictTask(taskPayload.parse(payload).taskId)),
    peer.register('desktop.browser-navigate', async (payload) => {
      const { taskId, url } = previewLoadPayload.parse(payload)
      return driverFor(taskId)?.navigate(url) ?? { ok: false, reason: 'No preview webview for this task — open the browser pane first.' }
    }),
    peer.register('desktop.browser-snapshot', async (payload) => {
      const driver = driverFor(taskPayload.parse(payload).taskId)
      return driver ? driver.takeSnapshot() : { error: 'No preview webview for this task — open the browser pane first.' }
    }),
    peer.register('desktop.browser-click', async (payload) => {
      const { taskId, ref } = browserClickPayload.parse(payload)
      return driverFor(taskId)?.click(ref) ?? { ok: false, reason: 'No preview webview for this task.' }
    }),
    peer.register('desktop.browser-fill', async (payload) => {
      const { taskId, ref, text } = browserFillPayload.parse(payload)
      return driverFor(taskId)?.fill(ref, text) ?? { ok: false, reason: 'No preview webview for this task.' }
    }),
    peer.register('desktop.browser-screenshot', async (payload) => {
      const driver = driverFor(taskPayload.parse(payload).taskId)
      return driver ? driver.screenshot() : { error: 'No preview webview for this task.' }
    }),
    peer.register('desktop.browser-console', (payload) => (
      driverFor(taskPayload.parse(payload).taskId)?.console() ?? { lines: [] }
    )),
  ]
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
