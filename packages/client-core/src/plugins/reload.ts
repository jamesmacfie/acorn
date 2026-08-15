// The client half of the reload path (docs/plugins.md § The dev loop).
//
// The node broadcasts a content-free `plugins:changed` when it swaps a plugin's node half; everything
// below is re-running passes that already exist, in the order boot runs them. There is no new
// registration mechanism here because there does not need to be one: the frame and chrome registries
// dispose-then-register, and a plugin frame is an iframe keyed by bundle hash AS ITS ORIGIN, so a new
// hash is a new origin and a new document with nothing carried over from the old one.
import { refreshNodePlugins } from '../node/nodePlugins'
import { wsOnPluginsChanged } from '../wsClient'
import { syncPluginDistribution } from './distribution'
import { syncPluginContributions } from './syncContributions'

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

/** Subscribe for the life of the shell. Returns the unsubscribe for symmetry with the other watchers;
 * the app never calls it. */
export function watchPluginChanges(): () => void {
  return wsOnPluginsChanged(() => {
    void reconcilePluginChange().catch((error) => console.warn('[plugins] could not reconcile a plugin change:', error))
  })
}
