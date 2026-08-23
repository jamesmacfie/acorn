import { fleetBridge } from '../platform'
import { activeNodeId } from './activeNode'
import { nodes } from './fleet'

// Rewrite a loopback URL resolved by a node so it is reachable from this machine
// (docs/shell.md § Host-owned webviews).
//
// The preview pane's URL comes from the node and is loaded by the client's shell. For the bundled
// local node those are the same machine. For a remote node `http://localhost:5173` points at the
// owner's laptop, where nothing is listening, and the pane shows a blank page.
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

// Returns the URL to load, unchanged whenever no tunnel is needed or possible:
//
//   - the active node is the local one, so a tunnel is a pointless hop
//   - the URL names a real host, already reachable, and tunnelling it would be the general proxy
//     docs/api-reference.md rules out
//   - there is no broker, so the origin is the node
//
// A failed tunnel returns null rather than the original URL. localhost is local to the node, so
// returning the input would point the preview at an unrelated local service.
export async function tunnelUrl(taskId: string, url: string | null): Promise<string | null> {
  if (!url) return url
  const nodeId = activeNodeId()
  // No broker or no node, so the origin is the node (`dev:node` in a browser) and nothing needs
  // rewriting.
  if (!nodeId) return url
  // The bundled local node is the same machine, so a tunnel is a pointless hop. `!== false` rather
  // than `=== true`, so an unknown node is left alone rather than tunnelled blindly.
  if (nodes().find((node) => node.nodeId === nodeId)?.local !== false) return url
  const target = loopbackTarget(url)
  // A real host is already reachable, and tunnelling it would be the general proxy
  // docs/api-reference.md rules out.
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

// Called when a preview pane goes away, including on task archive, so the loopback listener does not
// outlive what it was for.
//
// Scoped to the node as well as the task. Without the nodeId this matches every node's tunnels for
// that task id, and two nodes may hold the same task UUID, so unmounting one pane closes a live pipe
// on another machine.
export const closeTunnelsForTask = (taskId: string): void => {
  const nodeId = activeNodeId()
  fleetBridge()?.tunnelClose(nodeId ? { nodeId, taskId } : { taskId })
}
