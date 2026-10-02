import { fleetBridge } from '../platform'
import { activeNodeId } from './activeNode'
import { nodes } from './fleet'

// A node owns its preview URL. The desktop child webview can check top-level navigation but cannot
// confine redirects and page subrequests to the node's network. A remote page, even reached through a
// loopback tunnel, could contact services on the client's private network.
export function remotePreviewBlocked(nodeId: string | null = activeNodeId()): boolean {
  // A browser served by a node directly has no broker or fleet selection. On a desktop, even a
  // missing selection is unavailable until custody positively identifies the bundled local node.
  if (nodeId === null) return fleetBridge() !== null
  return nodes().find((node) => node.nodeId === nodeId)?.local !== true
}

export function previewUrlForClient(url: string | null, nodeId: string | null = activeNodeId()): string | null {
  return remotePreviewBlocked(nodeId) ? null : url
}

// Keep the older plugin API entrypoint for callers outside this repository. It no longer opens a
// tunnel; remote previews cannot safely run in the client's native webview.
export async function tunnelUrl(_taskId: string, url: string | null, nodeId: string | null = activeNodeId()): Promise<string | null> {
  return previewUrlForClient(url, nodeId)
}

// Called when a preview pane goes away, including on task archive, so the loopback listener does not
// outlive what it was for.
//
// Scoped to the node as well as the task. Without the nodeId this matches every node's tunnels for
// that task id, and two nodes may hold the same task UUID, so unmounting one pane closes a live pipe
// on another machine.
export const closeTunnelsForTask = (taskId: string, nodeId: string | null = activeNodeId()): void => {
  if (nodeId !== null) fleetBridge()?.tunnelClose({ nodeId, taskId })
}
