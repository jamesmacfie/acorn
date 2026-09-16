// The client half of the reload path (docs/plugins.md § The dev loop), and the trigger for the very
// first pass.
//
// The node broadcasts a content-free `plugins:changed` when it swaps a plugin's node half; everything
// below is re-running passes that already exist, in the order boot runs them. There is no new
// registration mechanism here because there does not need to be one: the frame and chrome registries
// dispose-then-register, and a plugin frame is an iframe keyed by bundle hash as its origin, so a new
// hash is a new origin and a new document with nothing carried over from the old one.
import { createEffect, createRoot } from 'solid-js'
import { nodes, nodeState } from '../../infra/node/fleet'
import { refreshNodePlugins } from '../../infra/node/nodePlugins'
import { wsOnPluginsChanged } from '../../infra/node/wsClient'
import { syncPluginDistribution } from './distribution'
import { syncPluginContributions } from './syncContributions'
import { createLogger } from '../../infra/telemetry/logger'

const log = createLogger('plugins')

/** Re-read the roster, re-resolve which bundle wins per plugin, and re-register every contribution.
 *
 * `repin` is the only difference from the boot pass. Trust is NOT bypassed by it: a plugin whose winning
 * hash changed to bytes this device has never accepted comes back from `eligiblePlugins()` as
 * `trusted: false`, which withholds its code-bearing surfaces and drops it from the chrome pass, while
 * `syncPluginDistribution` caches the new bundle and queues it for the trust dialog. The owner is asked
 * about the new bytes exactly as they were asked about the old ones. */
export async function reconcilePluginChange(): Promise<void> {
  await refreshNodePlugins()
  await syncPluginDistribution({ repin: true })
  syncPluginContributions()
}

/** Subscribe for the life of the shell: the node's own reload broadcast, and a node becoming reachable.
 *
 * The second one is what runs the first useful pass. Every host can start its renderer before the node
 * it just spawned is up (docs/performance.md § Every host draws first), and
 * `syncPluginDistribution` asks only nodes the broker calls reachable — at boot that is none of them,
 * and the fleet list is still empty besides.
 * So a pass fired from a composition root found no rosters, cached no bundles and registered no
 * surfaces, and nothing re-ran it: loaded plugins stayed missing for the whole session unless the owner
 * opened Settings → Plugins, which runs the pass on the way through. This is the same retry the bundled
 * plugins get in the desktop's App.tsx, for the same reason.
 *
 * Once per node, so a connection that flaps does not re-hash every bundle in the fleet. Returns the
 * unsubscribe for the broadcast half, for symmetry with the other watchers; the app never calls it. */
export function watchPluginChanges(): () => void {
  const asked = new Set<string>()
  createRoot(() => {
    createEffect(() => {
      const arrived = nodes().filter((node) => nodeState(node.nodeId) !== 'offline' && !asked.has(node.nodeId))
      if (!arrived.length) return
      for (const node of arrived) asked.add(node.nodeId)
      void syncPluginDistribution()
        .then(syncPluginContributions)
        .catch((error: unknown) => log.warn("could not read the fleet's plugins", error))
    })
  })
  return wsOnPluginsChanged(() => {
    void reconcilePluginChange().catch((error) => log.warn('could not reconcile a plugin change', error))
  })
}
