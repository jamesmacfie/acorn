// The client half of `tasks:changed` (docs/future/events/delivery.md defect 1).
//
// Every task write on the node announces itself (node-core/main/notify.ts § broadcastTasksChanged) and
// this turns that into one cache invalidation. The frame is content-free by design, so there is
// nothing to merge and no ordering to get wrong: the task list is a fetchable route, and the client
// re-reads it.
//
// It exists because the invalidation used to be the caller's job — `mutations.ts` still says "callers
// invalidate tasksKey after" — which is correct for the window that did the writing and silently wrong
// for every other one. A second client, a paired device, or an agent creating a child task moved
// nothing on screen until someone reconnected. One desktop and one node makes that an edge case; a
// fleet makes it the normal case.
import { activeCacheId } from '../node/activeNode'
import { clientFor } from '../node/fleet'
import { tasksKey } from '../queries'
import { clientEvents } from '../registries/clientEvents'
import { wsOnTasksChanged } from '../wsClient'

/** Subscribe for the life of the shell. Returns the unsubscribe for symmetry with the other watchers;
 * the app never calls it. */
export function watchTaskChanges(): () => void {
  return wsOnTasksChanged(() => {
    // The active node's cache only: the socket that delivered this belongs to it, and no other node
    // has a mounted query to refetch. Same reasoning as the reconnect sweep in the desktop bootstrap.
    void clientFor(activeCacheId()).client.invalidateQueries({ queryKey: tasksKey })
    // …and re-emit for everything that listens on the client bus rather than on the cache, which is
    // how a plugin frame hears it: the bus is the only thing a frame can subscribe to, and the socket
    // is not (plugins/frames/channels.ts).
    clientEvents.emit('tasks:changed', {})
  })
}
