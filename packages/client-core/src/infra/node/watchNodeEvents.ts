// The client half of `head:changed`, `run:changed` and `agent-session:changed`
// (docs/plugins.md § Hearing a core event). Each is re-emitted on the client bus, which is the only
// thing a plugin frame or a compiled-in consumer can subscribe to (plugins/frames/channels.ts).
// `run:changed` also refreshes the task's run targets, the one query of the three the shell caches.
import { clientEvents } from '../../host/registries/commands/clientEvents'
import { runTargetsKey } from '../queries'
import { activeCacheId } from './activeNode'
import { clientFor } from './fleet'
import { wsOnNodeEvent } from './wsClient'

/** Subscribe for the life of the shell. Returns one unsubscribe for the three, for symmetry with the
 * other watchers; the app never calls it. */
export function watchNodeEvents(): () => void {
  const offs = [
    wsOnNodeEvent('head:changed', (event) => clientEvents.emit('head:changed', event)),
    wsOnNodeEvent('run:changed', (event) => {
      // The active node's cache only, for the reason tasks/watchTaskChanges.ts gives.
      void clientFor(activeCacheId()).client.invalidateQueries({ queryKey: [...runTargetsKey, event.taskId] })
      clientEvents.emit('run:changed', event)
    }),
    wsOnNodeEvent('agent-session:changed', (event) => clientEvents.emit('agent-session:changed', event)),
  ]
  return () => offs.forEach((off) => off())
}
