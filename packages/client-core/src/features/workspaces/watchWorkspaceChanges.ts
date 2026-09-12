// The client half of the two workspace-owned core events. Workspace identity changes refresh the
// workspace roster; external-project changes refresh the scoped workspace projections and every
// connection-side mapping projection, because the event intentionally names a provider rather than
// leaking a connection id into the public contract.
import { activeCacheId } from '../../infra/node/activeNode'
import { clientFor } from '../../infra/node/fleet'
import { wsOnNodeEvent } from '../../infra/node/wsClient'
import { integrationMappingsRootKey, workspaceExternalProjectsKey, workspacesKey } from '../../infra/queries'
import { clientEvents } from '../../host/registries/commands/clientEvents'

/** Subscribe for the life of the shell. Both desktop and TUI install this during bootstrap. */
export function watchWorkspaceChanges(): () => void {
  const offs = [
    wsOnNodeEvent('workspace:changed', (event) => {
      void clientFor(activeCacheId()).client.invalidateQueries({ queryKey: workspacesKey })
      clientEvents.emit('workspace:changed', event)
    }),
    wsOnNodeEvent('workspace-projects:changed', (event) => {
      const client = clientFor(activeCacheId()).client
      for (const workspaceId of event.workspaceIds) {
        void client.invalidateQueries({ queryKey: workspaceExternalProjectsKey(workspaceId) })
      }
      void client.invalidateQueries({ queryKey: integrationMappingsRootKey })
      clientEvents.emit('workspace-projects:changed', event)
    }),
  ]
  return () => offs.forEach((off) => off())
}
