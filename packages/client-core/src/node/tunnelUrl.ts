import { acornGlobal } from '../capabilities'
import { activeNodeId } from './activeNode'
import { nodes } from './fleet'

// Rewrite a loopback URL resolved BY a node so it is reachable FROM this machine
// (docs/vNext/plugin-inventory.md § preview: "for remote nodes, 'localhost' means the node's host … local
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
//     proxy protocol.md rules out);
//   - there is no broker (a plain browser served by a node, where the origin IS the node).
//
// A failure to open the tunnel returns the original URL too. The pane then shows whatever the browser makes
// of an unreachable localhost, which is no worse than the state before this existed — and main logs why.
export async function tunnelUrl(taskId: string, url: string | null): Promise<string | null> {
  if (!url) return url
  const open = acornGlobal()?.nodeTunnelOpen
  const nodeId = activeNodeId()
  if (!open || !nodeId) return url
  if (nodes().find((node) => node.nodeId === nodeId)?.local !== false) return url
  const target = loopbackTarget(url)
  if (!target) return url
  try {
    const { port } = await open({ nodeId, taskId, port: target.port })
    return `http://127.0.0.1:${port}${target.rest}`
  } catch (error) {
    console.warn('[tunnel] could not open a preview tunnel:', error)
    return url
  }
}

// Called when a task is archived or its preview pane goes away, so the loopback listener does not outlive
// what it was for.
export const closeTunnelsForTask = (taskId: string): void => acornGlobal()?.nodeTunnelClose?.({ taskId })
