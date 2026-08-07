import type { NodePairRequest, NodeProbeResult, NodeRecord } from '@acorn/protocol/broker.ts'
import { acornGlobal } from '../capabilities'
import type { DevicesResponse, PairedDevice } from '@acorn/protocol/node.ts'
import { coreDeviceRoute, coreDevicesRoute } from '@acorn/protocol/api.ts'
import { readJson, sendJson } from '../apiClient'
import { clientEvents } from '../registries/clientEvents'
import { selectActiveNode } from './activeNode'
import { refreshFleet } from './fleet'

// Fleet mutations, as the renderer performs them: ask main, then re-read.
//
// Nothing here writes client state directly. Main owns fleet.json and the safeStorage tokens, so the
// projection in fleet.ts is only ever refreshed FROM main — which is what keeps "the renderer never
// holds a device token" true without anyone having to remember it.

const bridge = () => {
  const acorn = acornGlobal()
  // Absent in a plain browser (`dev:node`), where there is no broker and the origin IS the node. The
  // Nodes settings page hides itself in that mode rather than offering buttons that cannot work.
  if (!acorn?.nodeProbe) return null
  return acorn
}

export const fleetMutable = (): boolean => bridge() !== null

// Pairing step 2: reach the endpoint and get the fingerprint the owner must compare against the one
// the node displays. Main keeps the certificate; this returns only what the owner has to read.
export async function probeNodeEndpoint(endpoint: string): Promise<NodeProbeResult> {
  const acorn = bridge()
  if (!acorn?.nodeProbe) throw new Error('This build cannot pair nodes.')
  return acorn.nodeProbe(endpoint)
}

// Pairing step 3. Succeeds only against the endpoint just probed — main refuses otherwise, which is
// what makes the fingerprint confirmation load-bearing rather than decorative.
export async function pairNode(request: NodePairRequest): Promise<NodeRecord> {
  const acorn = bridge()
  if (!acorn?.nodePair) throw new Error('This build cannot pair nodes.')
  const node = await acorn.nodePair(request)
  await refreshFleet()
  return node
}

export async function renameNode(nodeId: string, label: string): Promise<void> {
  await bridge()?.nodeRename?.(nodeId, label)
  await refreshFleet()
}

// Unpair (`revoke: false`) or revoke-and-unpair (`revoke: true`). The distinction is main's to act on;
// what matters here is that BOTH end with this client's cache for that node gone — a removed node whose
// tasks were still cached would render rows the owner can no longer reach.
export async function removeNode(nodeId: string, revoke: boolean): Promise<void> {
  await bridge()?.nodeForget?.(nodeId, revoke)
  // The evictor is registered by the app composition root (scopedEviction.ts), so this announces the
  // removal rather than reaching into the cache itself.
  clientEvents.emit('runtime:node-removed', { nodeId })
  await refreshFleet()
  // Re-home if that was the active node; a no-op otherwise, because selectActiveNode keeps a
  // still-known selection.
  await selectActiveNode()
}

export function reconnectNode(nodeId: string): void {
  bridge()?.nodeReconnect?.(nodeId)
}

// Stop and start the supervised local node, so a plugin toggle takes effect (settings/PluginsSettings.tsx).
// Absent in a plain browser and for every remote node — nothing this app runs restarts another machine's
// service, which is why the page shows "restart required" there rather than a button that cannot work.
export const restartLocalNode = async (): Promise<void> => {
  const restart = bridge()?.nodeRestartLocal
  if (!restart) throw new Error('This build does not supervise a local node.')
  await restart()
}

// The node's OWN device list — every client paired with it, not just this one. docs/ui-design.md § New surfaces asks for
// "revoke this or other devices", and only the first half existed: `removeNode(nodeId, revoke)` deletes THIS
// client's row. A laptop that was lost, or a machine that was reinstalled, had no way to be cut off short of
// re-pairing everything.
//
// Device-only on the node (routes/pairing.ts, gated in server/index.ts), which is why it is here beside the
// other fleet mutations rather than in a plugin.
export const nodeDevices = async (nodeId: string): Promise<PairedDevice[]> =>
  (await readJson<DevicesResponse>(coreDevicesRoute, { nodeId })).devices

// Revoking a device closes its sockets immediately and fails its in-flight requests
// (docs/api-reference.md § Pairing). Revoking THIS client's own row is possible and is not stopped here: it
// is the same thing `removeNode(nodeId, true)` does, and the caller is better placed to warn about it.
export const revokeNodeDevice = async (nodeId: string, deviceId: string): Promise<void> => {
  await sendJson(coreDeviceRoute(deviceId), { method: 'DELETE', nodeId })
}
