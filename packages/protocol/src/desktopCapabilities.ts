import type { PreviewNavState, ServiceRpcPeer } from './serviceProtocol'

export type PreviewDesktopCapability = {
  currentUrl(taskId: string): Promise<string | null>
  loadUrl(taskId: string, url: string): Promise<boolean>
  navState(taskId: string): Promise<PreviewNavState | null>
  navigate(taskId: string, action: 'back' | 'forward' | 'reload' | 'stop'): Promise<boolean>
  evict(taskId: string): Promise<boolean>
}

export type DesktopCapabilities = {
  preview: PreviewDesktopCapability
}

// Service-side projection of the small native surface a shell exposes. The utility service never
// receives a window or webview handle; it can only issue task-addressed commands.
//
// The `browser` half of this seam is gone: agent browser automation is a plugin now, driving a real
// browser on the node rather than the desktop's preview pane over CDP
// (docs/future/tauri/webviews-and-frames.md § Agent browser automation).
//
// What is left has no caller in the node today — nothing reachable from `service/runtime.ts` reads
// `desktop.preview` — and it is kept because it is the seam a node-side caller would use to drive the
// pane, which is a reasonable thing to want. The Tauri shell registers no handler for it and records
// the waiver in docs/future/tauri/sequencing.md § Phase 3.
export function desktopCapabilitiesOverRpc(peer: ServiceRpcPeer): DesktopCapabilities {
  return {
    preview: {
      currentUrl: (taskId) => peer.request('desktop.preview-current-url', { taskId }),
      loadUrl: (taskId, url) => peer.request('desktop.preview-load-url', { taskId, url }),
      navState: (taskId) => peer.request('desktop.preview-nav-state', { taskId }),
      navigate: (taskId, action) => peer.request('desktop.preview-navigate', { taskId, action }),
      evict: (taskId) => peer.request('desktop.preview-evict', { taskId }),
    },
  }
}
