// The client half of `head:changed`, `run:changed` and `agent-session:changed`
// (docs/plugins.md § Hearing a core event). None of them backs a query the shell caches, so there is
// nothing to invalidate: each is re-emitted on the client bus, which is the only thing a plugin frame
// or a compiled-in consumer can subscribe to (plugins/frames/channels.ts).
import { clientEvents } from './registries/clientEvents'
import { wsOnNodeEvent } from './wsClient'

/** Subscribe for the life of the shell. Returns one unsubscribe for the three, for symmetry with the
 * other watchers; the app never calls it. */
export function watchNodeEvents(): () => void {
  const offs = [
    wsOnNodeEvent('head:changed', (event) => clientEvents.emit('head:changed', event)),
    wsOnNodeEvent('run:changed', (event) => clientEvents.emit('run:changed', event)),
    wsOnNodeEvent('agent-session:changed', (event) => clientEvents.emit('agent-session:changed', event)),
  ]
  return () => offs.forEach((off) => off())
}
