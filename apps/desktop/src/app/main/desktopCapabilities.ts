import { z } from 'zod'
import type { ServiceRpcPeer } from '@acorn/protocol/serviceProtocol.ts'
import {
  previewCurrentUrl,
  previewEvictTask,
  previewLoadUrl,
  previewNavigate,
  previewNavState,
} from '@acorn/plugin-preview/main/index.ts'

const taskPayload = z.strictObject({ taskId: z.string().min(1) })
const previewLoadPayload = taskPayload.extend({ url: z.string() })
const previewNavigatePayload = taskPayload.extend({
  action: z.enum(['back', 'forward', 'reload', 'stop']),
})

// The shell-only capabilities the node service can call back into. Only the preview half is left:
// agent browser automation moved to `plugins/browser`, where the browser belongs to the node
// (docs/future/tauri/webviews-and-frames.md § Agent browser automation).
//
// Nothing in the node calls these today. They are registered anyway, because the cost is five lines
// and the alternative — deleting the seam and rebuilding it the first time something node-side wants
// to drive the pane — is the worse trade.
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
  ]
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}
