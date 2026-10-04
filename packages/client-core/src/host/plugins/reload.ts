import { createEffect, createRoot } from 'solid-js'
import { activeCacheId, activeNodeId } from '../../infra/node/activeNode'
import { clientFor, nodes, nodeState } from '../../infra/node/fleet'
import { refreshNodePlugins } from '../../infra/node/nodePlugins'
import { wsOnFleetPluginsChanged } from '../../infra/node/wsClient'
import {
  distribution, forgetPluginNode, markPluginNodeStale, notifyActivePluginNodeChanged,
  onPluginDistributionCommit, syncPluginDistribution,
} from './distribution'
import { syncPluginContributions } from './syncContributions'
import { createLogger } from '../../infra/telemetry/logger'
import { invalidateDataSources } from '../../features/dataSources/queries'
import { invalidatePublishedPanels } from '../../features/dashboards/dashboardClient'

const log = createLogger('plugins')

/** Reconcile only the node whose plugin state changed. */
export async function reconcilePluginChange(nodeId: string = activeNodeId() ?? ''): Promise<void> {
  if (!nodeId) return
  if (nodeId === activeNodeId()) {
    await refreshNodePlugins(nodeId)
    void invalidateDataSources(clientFor(activeCacheId()).client, activeCacheId())
    // The plugin frame names only the Node, so every placed panel on it refetches.
    void invalidatePublishedPanels(clientFor(activeCacheId()).client, activeCacheId())
  }
  await syncPluginDistribution({ nodeIds: [nodeId] })
}

/** A device install, update, toggle, or removal needs no node roster request. */
export async function reconcileDevicePluginChange(): Promise<void> {
  await syncPluginDistribution({ deviceOnly: true })
  syncPluginContributions()
}

/** Plugin lifecycle events are fleet control events. Ordinary task streams still obey the active
 * node WebSocket filter. The status effect tracks transitions, so reconnects read again. */
export function watchPluginChanges(): () => void {
  const unsubscribeCommit = onPluginDistributionCommit(syncPluginContributions)
  // Device bundles can register before any node has connected. Reconciliation is serialized with
  // subsequent fleet reads in distribution.ts, so an arriving node cannot overtake this pass.
  void reconcileDevicePluginChange().catch((error: unknown) => log.warn('could not read device plugins', error))
  const unsubscribeSocket = wsOnFleetPluginsChanged((nodeId) => {
    void reconcilePluginChange(nodeId).catch((error) => log.warn('could not reconcile a plugin change', error))
  })
  const disposeEffect = createRoot((dispose) => {
    let previous = new Map<string, string>()
    let selected: string | null = null
    createEffect(() => {
      const current = new Map(nodes().map((node) => [node.nodeId, nodeState(node.nodeId)]))
      const nextSelected = activeNodeId()
      for (const id of previous.keys()) if (!current.has(id)) forgetPluginNode(id)
      const reads: string[] = []
      for (const [id, status] of current) {
        const before = previous.get(id)
        if (status === 'offline') {
          markPluginNodeStale(id)
        } else if (before === undefined || before === 'offline' || before !== status) {
          reads.push(id)
        }
      }
      if (nextSelected !== selected) {
        selected = nextSelected
        notifyActivePluginNodeChanged()
        const observation = nextSelected ? distribution().byNode.get(nextSelected) : undefined
        if (nextSelected && !observation?.reachable && current.get(nextSelected) !== 'offline') reads.push(nextSelected)
      }
      previous = current
      if (reads.length) void syncPluginDistribution({ nodeIds: [...new Set(reads)] })
        .catch((error) => log.warn("could not read the fleet's plugins", error))
    })
    return dispose
  })
  return () => {
    unsubscribeSocket()
    unsubscribeCommit()
    disposeEffect()
  }
}
