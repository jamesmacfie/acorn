import { fleetBridge, previewProxy } from '../platform'
import { activeNodeId } from './activeNode'
import { nodes } from './fleet'

// How a task's preview address reaches the native webview (docs/shell/webviews.md § The preview URL).
//
// - `direct`: the local Node's app, loaded as it is.
// - `proxied`: a remote Node's app on that Node's loopback, loaded through a listener of this computer's own
//   (`previewProxy`), which reaches the app through the Node and holds the page to it. `path` is the app's start
//   page.
// - `blocked`: nothing is loaded. `unsupported` means this computer can't confine a remote page, and
//   `not-loopback` means the address isn't an app on the Node's own loopback, which the Node won't proxy.
export type PreviewBlockedReason = 'unsupported' | 'not-loopback'
export type PreviewTarget =
  | { kind: 'direct'; url: string }
  | { kind: 'proxied'; nodeId: string; path: string }
  | { kind: 'blocked'; reason: PreviewBlockedReason }

// The names the Node's loopback route accepts (plugins/preview/src/server/loopbackPort.ts).
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function previewTarget(url: string, nodeId: string | null = activeNodeId()): PreviewTarget {
  if (!remotePreviewBlocked(nodeId)) return { kind: 'direct', url }
  if (!nodeId || !previewProxy() || !nodes().some((node) => node.nodeId === nodeId))
    return { kind: 'blocked', reason: 'unsupported' }
  const parsed = URL.canParse(url) ? new URL(url) : null
  if (parsed?.protocol !== 'http:' || !LOOPBACK_HOSTS.has(parsed.hostname))
    return { kind: 'blocked', reason: 'not-loopback' }
  return { kind: 'proxied', nodeId, path: `${parsed.pathname}${parsed.search}${parsed.hash}` }
}

// Whether a Node's address may go to the webview as it is. Only the local Node's may: a remote page loaded
// directly could contact services on the client's private network. Kept for plugins, which use it, until the
// next plugin API major (docs/plugins/forward-compatibility.md). `previewTarget` says what to do instead.
export function remotePreviewBlocked(nodeId: string | null = activeNodeId()): boolean {
  // A browser served by a node directly has no broker or fleet selection. On a desktop, even a
  // missing selection is unavailable until custody positively identifies the bundled local node.
  if (nodeId === null) return fleetBridge() !== null
  return nodes().find((node) => node.nodeId === nodeId)?.local !== true
}

export function previewUrlForClient(url: string | null, nodeId: string | null = activeNodeId()): string | null {
  return remotePreviewBlocked(nodeId) ? null : url
}
