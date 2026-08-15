import { fleetBridge } from '../platform'
import { activeNodeId } from './activeNode'
import { nodes } from './fleet'

// Rewrite a loopback URL resolved BY a node so it is reachable FROM this machine
// (docs/plugins.md § preview: "for remote nodes, 'localhost' means the node's host … local
// nodes skip it").
//
// The preview pane's URL comes from the node — a run target's `url`, a repo's `previewMode: 'port'`, a URL
// script's stdout — and is then loaded by the client's Electron main. For the bundled local node those are
// the same machine and nothing needs doing. For a remote node `http://localhost:5173` points at the owner's
// laptop, where nothing is listening, and the pane shows a blank page.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0'])

// Exported for the test: the two facts that decide whether a URL needs a tunnel at all.
export function loopbackTarget(url: string): { port: number; rest: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) return null
  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80))
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return { port, rest: `${parsed.pathname}${parsed.search}${parsed.hash}` }
}

// Returns the URL to load, which is the input unchanged whenever no tunnel is needed or possible:
//
//   - the active node is the local one (same machine — a tunnel would be a pointless hop);
//   - the URL names a real host (already reachable from here, and tunnelling it would be the general
//     proxy docs/api-reference.md rules out);
//   - there is no broker (a plain browser served by a node, where the origin IS the node).
//
// A failure to open the tunnel returns NULL, not the original URL, and that is the security-relevant half.
//
// A remote loopback URL is only usable when the build can open the node-owned tunnel: localhost is local
// to the Node, not the client. Returning null prevents the preview from showing an unrelated local service.
export async function tunnelUrl(taskId: string, url: string | null): Promise<string | null> {
  if (!url) return url
  const nodeId = activeNodeId()
  // No broker, or no node: the origin IS the node (`dev:node` in a browser), so nothing needs rewriting.
  if (!nodeId) return url
  // The bundled local node — same machine, so a tunnel would be a pointless extra hop. `!== false` rather
  // than `=== true`: an unknown node is treated as local and left alone rather than tunnelled blindly.
  if (nodes().find((node) => node.nodeId === nodeId)?.local !== false) return url
  const target = loopbackTarget(url)
  // A real host is already reachable from here, and tunnelling it would be the general proxy docs/api-reference.md
  // rules out.
  if (!target) return url
  const bridge = fleetBridge()
  if (!bridge) {
    console.warn('[tunnel] this build cannot tunnel, so a remote loopback preview is unavailable')
    return null
  }
  try {
    const { port } = await bridge.tunnelOpen({ nodeId, taskId, port: target.port })
    return `http://127.0.0.1:${port}${target.rest}`
  } catch (error) {
    console.warn('[tunnel] could not open a preview tunnel:', error)
    return null
  }
}

// Called when a preview pane goes away (and so on task archive, which unmounts it), so the loopback
// listener does not outlive what it was for.
//
// Scoped to the node as well as the task. Without the nodeId this matched every node's tunnels for that
// task id — and two nodes may hold the same task UUID by construction, so unmounting one pane could close
// a live pipe belonging to a different machine.
export const closeTunnelsForTask = (taskId: string): void => {
  const nodeId = activeNodeId()
  fleetBridge()?.tunnelClose(nodeId ? { nodeId, taskId } : { taskId })
}
