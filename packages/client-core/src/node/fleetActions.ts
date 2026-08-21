import type { NodePairRequest, NodeProbeResult, NodeRecord } from '@acorn/protocol/broker.ts'
import { canPairNodes, fleetBridge } from '../platform'
import type { DevicesResponse, PairedDevice } from '@acorn/protocol/node.ts'
import { coreDeviceRoute, coreDevicesRoute } from '@acorn/protocol/api.ts'
import { readJson, sendJson } from '../apiClient'
import { clientEvents } from '../registries/clientEvents'
import { selectActiveNode } from './activeNode'
import { refreshFleet } from './fleet'

// Fleet mutations, as the renderer performs them: ask main, then re-read.
//
// Nothing here writes client state directly. Main owns fleet.json and the safeStorage tokens, so the
// projection in fleet.ts is only ever refreshed from main (docs/architecture-overview.md § Process
// ownership), which is what keeps "the renderer never holds a device token" true without anyone
// having to remember it.

// Absent in a plain browser (`dev:node`), where there is no broker and the origin is the node. The
// Nodes settings page hides itself in that mode rather than offering buttons that cannot work.
export const fleetMutable = (): boolean => canPairNodes()

// Pairing step 2: reach the endpoint and get the fingerprint the owner must compare against the one
// the node displays. Main keeps the certificate; this returns only what the owner has to read.
export async function probeNodeEndpoint(endpoint: string): Promise<NodeProbeResult> {
  const bridge = fleetBridge()
  if (!bridge) throw new Error('This build cannot pair nodes.')
  return bridge.probe(endpoint)
}

// Pairing step 3. Succeeds only against the endpoint just probed. Main refuses otherwise, which is
// what makes the fingerprint confirmation load-bearing rather than decorative.
export async function pairNode(request: NodePairRequest): Promise<NodeRecord> {
  const bridge = fleetBridge()
  if (!bridge) throw new Error('This build cannot pair nodes.')
  const node = await bridge.pair(request)
  await refreshFleet()
  return node
}

export async function renameNode(nodeId: string, label: string): Promise<void> {
  await fleetBridge()?.rename(nodeId, label)
  await refreshFleet()
}

// Unpair (`revoke: false`) or revoke-and-unpair (`revoke: true`). The distinction is main's to act on;
// what matters here is that both end with this client's cache for that node gone. A removed node whose
// tasks were still cached would render rows the owner can no longer reach.
export async function removeNode(nodeId: string, revoke: boolean): Promise<void> {
  await fleetBridge()?.forget(nodeId, revoke)
  // The evictor is registered by the app composition root (scopedEviction.ts), so this announces the
  // removal rather than reaching into the cache itself.
  clientEvents.emit('runtime:node-removed', { nodeId })
  await refreshFleet()
  // Re-home if that was the active node; a no-op otherwise, because selectActiveNode keeps a
  // still-known selection.
  await selectActiveNode()
}

export function reconnectNode(nodeId: string): void {
  fleetBridge()?.reconnect(nodeId)
}

// Stop and start the supervised local node, so a plugin toggle takes effect
// (settings/PluginsSettings.tsx). Absent in a plain browser and for every remote node: nothing this
// app runs restarts another machine's service, which is why the page shows "restart required" there
// instead of a button that cannot work.
export const restartLocalNode = async (): Promise<void> => {
  const bridge = fleetBridge()
  if (!bridge) throw new Error('This build does not supervise a local node.')
  await bridge.restartLocal()
}

// The node's own device list: every client paired with it, not just this one
// (docs/security.md § Trust boundaries). `removeNode(nodeId, revoke)` deletes only this client's row;
// this is what lets a lost or reinstalled machine be cut off without re-pairing everything.
//
// Device-only on the node (routes/pairing.ts, gated in server/index.ts), which is why it is here
// beside the other fleet mutations rather than in a plugin.
export const nodeDevices = async (nodeId: string): Promise<PairedDevice[]> =>
  (await readJson<DevicesResponse>(coreDevicesRoute, { nodeId })).devices

// Revoking a device closes its sockets immediately and fails its in-flight requests
// (docs/security.md § Transport and auth). Revoking this client's own row is possible and is not
// stopped here: it is the same thing `removeNode(nodeId, true)` does, and the caller is better placed
// to warn about it.
export const revokeNodeDevice = async (nodeId: string, deviceId: string): Promise<void> => {
  await sendJson(coreDeviceRoute(deviceId), { method: 'DELETE', nodeId })
}
