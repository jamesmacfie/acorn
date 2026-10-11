import { taskScriptsKey } from '@acorn/protocol/taskScripts.ts'
// The client half of `tasks:changed` (docs/plugins/events.md § Hearing a core event).
//
// Every task write on the node announces itself (`broadcastTasksChanged`) and this turns that into one
// cache invalidation. The frame names one task, or null for a batch, but the shell's source of truth
// is still its list query, so it re-reads it.
//
// A caller's own invalidation only reaches the window that did the writing. Without this, a second
// client, a paired device, or an agent creating a child task moves nothing on screen until someone
// reconnects.
import { activeCacheId } from '../../infra/node/activeNode'
import { clientFor } from '../../infra/node/fleet'
import { tasksKey } from '../../infra/queries'
import { clientEvents } from '../../host/registries/commands/clientEvents'
import { wsOnTasksChanged } from '../../infra/node/wsClient'

/** Subscribe for the life of the shell. Returns the unsubscribe for symmetry with the other watchers;
 * the app never calls it. */
export function watchTaskChanges(): () => void {
  return wsOnTasksChanged((event) => {
    // The active node's cache only: the socket that delivered this belongs to it, and no other node
    // has a mounted query to refetch. Same reasoning as the reconnect sweep in the desktop bootstrap.
    void clientFor(activeCacheId()).client.invalidateQueries({ queryKey: tasksKey })
    void clientFor(activeCacheId()).client.invalidateQueries({
      queryKey: event.taskId ? [...taskScriptsKey, event.taskId] : taskScriptsKey,
    })
    // …and re-emit for everything that listens on the client bus rather than on the cache, which is
    // how a plugin frame hears it: a frame can subscribe to the bus but not to the socket.
    clientEvents.emit('tasks:changed', event)
  })
}
