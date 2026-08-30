// The client half of `connection:changed` (docs/plugins.md § Hearing a core event).
//
// Nine writers on the node move a connection's status, and six of them are not the owner clicking
// anything: a credential that stopped being readable demotes itself to `needs-auth` mid-request. Until
// this existed, a client found out by refetching on suspicion, and onboarding hand-invalidated after
// connecting because nothing else would (`GithubConnect.tsx`).
//
// The frame carries the new status, and this still throws it away and refetches. The list route
// resolves capabilities and the synthesized GitHub row on top of the stored one, so patching a status
// into the cache would leave the rest of that projection behind. The payload is for the plugin bus,
// where a listener uses it to ignore a provider it does not own.
import { integrationsKey } from '../infra/queries'
import { activeCacheId } from '../infra/node/activeNode'
import { clientFor } from '../infra/node/fleet'
import { clientEvents } from '../registries/clientEvents'
import { wsOnConnectionChanged } from '../infra/node/wsClient'

/** Subscribe for the life of the shell. Returns the unsubscribe for symmetry with the other watchers;
 * the app never calls it. */
export function watchConnectionChanges(): () => void {
  return wsOnConnectionChanged((event) => {
    // The active node's cache only, for the same reason as the task watcher: the socket that delivered
    // this belongs to it, and no other node has a mounted query to refetch.
    void clientFor(activeCacheId()).client.invalidateQueries({ queryKey: integrationsKey })
    clientEvents.emit('connection:changed', event)
  })
}
