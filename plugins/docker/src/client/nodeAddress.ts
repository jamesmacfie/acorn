import { activeNodeId, nodes } from '@acorn/plugin-api/client'
import type { DockerPort } from '../shared/model'

// 127.0.0.0/8, the IPv6 loopback, and the name. Docker answers a port bound there only on its own host.
const LOOPBACK = /^(?:127\.|::1$|localhost$)/

/** The Node that runs Docker, when it's on another machine than this client. */
export const remoteNode = (nodeId = activeNodeId()) => nodes().find((node) => node.nodeId === nodeId && !node.local)

/** A published port's address from this client, or null for an unpublished port. Docker publishes on
 *  the Node's machine, so a remote Node's address takes the host from the Node's endpoint. `caveat`
 *  says why a port bound to that machine's loopback won't open from here. */
export function portAddress(port: DockerPort, nodeId = activeNodeId()): { url: string; caveat?: string } | null {
  if (!port.hostPort) return null
  const node = remoteNode(nodeId)
  if (!node) return { url: `http://localhost:${port.hostPort}` }
  if (port.hostIp && LOOPBACK.test(port.hostIp))
    return {
      url: `http://localhost:${port.hostPort}`,
      caveat: `It's only reachable on ${node.label}, or through an SSH tunnel to it.`,
    }
  return { url: `http://${new URL(node.endpoint).hostname}:${port.hostPort}` }
}
