import { createEffect, createRoot } from 'solid-js'
import { render } from 'solid-js/web'
import { startClientRuntime } from '@acorn/client-core/host/clientRuntime.ts'
import { setRegionPlaceholder } from '@acorn/client-core/host/layouts'
import { RegionLoading } from '@acorn/client-core/host/layouts/RegionLoading.tsx'
import {
  activeCacheId,
  activeNodeId,
  nodeReadiness,
  selectActiveNode,
} from '@acorn/client-core/infra/node/activeNode.ts'
import { clientFor, nodes, nodeState } from '@acorn/client-core/infra/node/fleet.ts'
import { refreshNodePlugins } from '@acorn/client-core/infra/node'
import { wsOnReconnect } from '@acorn/client-core/infra/node/wsClient.ts'
import '@acorn/client-core/infra/styles/styles.css'
import './mobile.css'
import { installRoster } from './roster'
import { Shell } from './Shell'

// The phone's composition root, after the seam: the runtime every client shares, the Node selection,
// and the shell. The desktop's is apps/desktop/src/client/index.tsx, and this keeps its order.

// Telemetry, the Node event watchers, notices, client schedules and device config sync
// (client-core/host/clientRuntime.ts). The phone draws the desktop's DOM plugin halves and runs no
// loaded plugin, so it names the desktop as its app. Telemetry stays off: nothing here switches it on.
void startClientRuntime({ runtime: 'renderer', app: 'desktop', client: () => clientFor(activeCacheId()).client })

// What a pane's region draws while its code loads. The DOM's layouts are the registry's default.
setRegionPlaceholder(RegionLoading)

// A dropped socket means missed events and no history to replay, so what is on screen refetches.
wsOnReconnect(() => void clientFor(activeCacheId()).client.invalidateQueries({ refetchType: 'active' }))

void selectActiveNode()

createRoot(() => {
  // A gateway that was down at boot fails the first selection. Its first status after it comes back
  // makes the fleet list the Node again (`refreshFleet`), and that is the moment to select it.
  createEffect(() => {
    if (nodes().length && nodeReadiness().kind === 'failed') void selectActiveNode()
  })
  // Each time the Node is reachable again: read which plugins it runs, which is what a pane's
  // `requires` asks (`hasHostCapability`; a host without plugin custody has no other source), and ask
  // again for the reads that failed while it was down. `wsOnReconnect` ignores a first connect.
  createEffect(() => {
    const nodeId = activeNodeId()
    if (!nodeId || nodeState(nodeId) === 'offline') return
    void refreshNodePlugins(nodeId)
    void clientFor(activeCacheId()).client.invalidateQueries({ refetchType: 'active' }, { cancelRefetch: false })
  })
})

render(() => <Shell />, document.getElementById('root')!)

// The built-in plugins after the first frame (./roster.ts).
requestAnimationFrame(() => setTimeout(() => void installRoster()))
