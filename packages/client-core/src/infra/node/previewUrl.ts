import { fleetBridge } from '../platform'
import { activeNodeId } from './activeNode'
import { nodes } from './fleet'

// A node owns its preview URL. The desktop child webview can check top-level navigation but cannot
// confine redirects and page subrequests to the node's network. A remote page could contact services
// on the client's private network.
export function remotePreviewBlocked(nodeId: string | null = activeNodeId()): boolean {
  // A browser served by a node directly has no broker or fleet selection. On a desktop, even a
  // missing selection is unavailable until custody positively identifies the bundled local node.
  if (nodeId === null) return fleetBridge() !== null
  return nodes().find((node) => node.nodeId === nodeId)?.local !== true
}

export function previewUrlForClient(url: string | null, nodeId: string | null = activeNodeId()): string | null {
  return remotePreviewBlocked(nodeId) ? null : url
}
