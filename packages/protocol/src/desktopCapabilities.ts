import type { PreviewNavState, ServiceRpcPeer } from './serviceProtocol'

export type PreviewDesktopCapability = {
  currentUrl(taskId: string): Promise<string | null>
  loadUrl(taskId: string, url: string): Promise<boolean>
  navState(taskId: string): Promise<PreviewNavState | null>
  navigate(taskId: string, action: 'back' | 'forward' | 'reload' | 'stop'): Promise<boolean>
  evict(taskId: string): Promise<boolean>
}

export type BrowserDesktopCapability = {
  navigate(taskId: string, url: string): Promise<unknown>
  snapshot(taskId: string): Promise<unknown>
  click(taskId: string, ref: string): Promise<unknown>
  fill(taskId: string, ref: string, text: string): Promise<unknown>
  screenshot(taskId: string): Promise<unknown>
  console(taskId: string): Promise<unknown>
}

export type DesktopCapabilities = {
  preview: PreviewDesktopCapability
  browser: BrowserDesktopCapability
}

// Service-side projection of the deliberately small native surface. The utility service never
// receives a BrowserWindow/WebContents handle; it can only issue task-addressed commands.
export function desktopCapabilitiesOverRpc(peer: ServiceRpcPeer): DesktopCapabilities {
  return {
    preview: {
      currentUrl: (taskId) => peer.request('desktop.preview-current-url', { taskId }),
      loadUrl: (taskId, url) => peer.request('desktop.preview-load-url', { taskId, url }),
      navState: (taskId) => peer.request('desktop.preview-nav-state', { taskId }),
      navigate: (taskId, action) => peer.request('desktop.preview-navigate', { taskId, action }),
      evict: (taskId) => peer.request('desktop.preview-evict', { taskId }),
    },
    browser: {
      navigate: (taskId, url) => peer.request('desktop.browser-navigate', { taskId, url }),
      snapshot: (taskId) => peer.request('desktop.browser-snapshot', { taskId }),
      click: (taskId, ref) => peer.request('desktop.browser-click', { taskId, ref }),
      fill: (taskId, ref, text) => peer.request('desktop.browser-fill', { taskId, ref, text }),
      screenshot: (taskId) => peer.request('desktop.browser-screenshot', { taskId }),
      console: (taskId) => peer.request('desktop.browser-console', { taskId }),
    },
  }
}
