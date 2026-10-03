// The client half of `connection:changed` (docs/plugins/events.md § Hearing a core event).
//
// Status writers and connection deletion announce the row's current state. Several status changes are
// not the owner clicking anything: a credential that stopped being readable demotes itself to
// `needs-auth` mid-request. Until this existed, a client found out by refetching on suspicion.
//
// The frame carries the new status or says the row was deleted, and this still refetches. The list route
// resolves capabilities and the synthesized GitHub row on top of the stored one, so patching a status
// into the cache would leave the rest of that projection behind. The payload is for the plugin bus,
// where a listener uses it to ignore a provider it does not own.
import { integrationsKey } from '../../infra/queries'
import { activeCacheId } from '../../infra/node/activeNode'
import { clientFor } from '../../infra/node/fleet'
import { clientEvents } from '../../host/registries/commands/clientEvents'
import { wsOnConnectionChanged } from '../../infra/node/wsClient'
import { invalidateDataSources } from '../dataSources/queries'
import { CONNECTION_ATTENTION_ID } from '../settings/connections/connectionAttention'

/** Subscribe for the life of the shell. Returns the unsubscribe for symmetry with the other watchers;
 * the app never calls it. */
export function watchConnectionChanges(): () => void {
  return wsOnConnectionChanged((event) => {
    // The active node's cache only, for the same reason as the task watcher: the socket that delivered
    // this belongs to it, and no other node has a mounted query to refetch.
    void clientFor(activeCacheId()).client.invalidateQueries({ queryKey: integrationsKey })
    // The bell's row and the settings rail's dot for a refused credential are a fan-out, which hears
    // an invalidation of its own key and nothing else (../../infra/node/fanout.ts).
    void clientFor(activeCacheId()).client.invalidateQueries({ queryKey: ['attention', CONNECTION_ATTENTION_ID] })
    void invalidateDataSources(clientFor(activeCacheId()).client, activeCacheId(), { connectionId: event.integrationId })
    clientEvents.emit('connection:changed', event)
  })
}
