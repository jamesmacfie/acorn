// The client half of `project:changed` (docs/plugins.md § Hearing a core event).
//
// Every project write on the node announces itself (node-core/server/notify.ts § broadcastProjectChanged)
// and this turns it into one cache invalidation plus a re-emit on the client bus, exactly as
// tasks/watchTaskChanges.ts does for tasks. It replaces the hand-invalidation onboarding did after
// creating a project, which was right for that window and silent for every other one.
import { activeCacheId } from '../../infra/node/activeNode'
import { clientFor } from '../../infra/node/fleet'
import { projectsKey, workspacesKey } from '../../infra/queries'
import { clientEvents } from '../../host/registries/commands/clientEvents'
import { wsOnNodeEvent } from '../../infra/node/wsClient'

/** Subscribe for the life of the shell. Returns the unsubscribe for symmetry with the other watchers;
 * the app never calls it. */
export function watchProjectChanges(): () => void {
  return wsOnNodeEvent('project:changed', (event) => {
    void clientFor(activeCacheId()).client.invalidateQueries({ queryKey: projectsKey })
    // Workspace rows embed their project membership, so moving, creating, or deleting a project
    // invalidates both projections even though `project:changed` remains the one wire contract.
    void clientFor(activeCacheId()).client.invalidateQueries({ queryKey: workspacesKey })
    clientEvents.emit('project:changed', event)
  })
}
