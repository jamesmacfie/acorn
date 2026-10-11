import { clientEvents } from '@acorn/client-core/host/registries/commands'
import { evictScope } from '@acorn/client-core/host/registries/shell'
import { dropNode } from '@acorn/client-core/infra/node/fleet.ts'

// Maps runtime lifecycle events onto scope evictions, and nothing else. Each state owner registers its
// own evictor with `onScopeEvicted` beside the signal it clears, so the shell doesn't know who is
// listening. A missed eviction is silent and looks like a data bug: node A's agent roster renders under
// node B, against ids that may collide across nodes by construction
// (docs/architecture/fleet.md § Client state and fleet behavior).
export function activateScopedStateEviction(): () => void {
  const offTask = clientEvents.on('runtime:task-archived', ({ taskId }) => evictScope({ scope: 'task', taskId }))
  const offWorkspace = clientEvents.on('runtime:workspace-removed', ({ workspaceId }) =>
    evictScope({ scope: 'workspace', workspaceId }),
  )
  // One call, where task-archival fans out to many listeners. That is the per-node QueryClient paying
  // off: every piece of a node's cached data lives in that node's client and nowhere else, so there is
  // exactly one thing to drop.
  const offNode = clientEvents.on('runtime:node-removed', ({ nodeId }) => dropNode(nodeId))
  // And this is where that payoff stops. Feature state held in module-level signals sits outside the
  // QueryClient partition and survives a node switch. Only live rosters clear; durable per-task and
  // per-workspace memory is keyed by node instead, so switching back restores it.
  const offSwitch = clientEvents.on('runtime:node-switched', ({ from, to }) =>
    evictScope({ scope: 'node-switched', from, to }),
  )
  return () => {
    offSwitch()
    offNode()
    offWorkspace()
    offTask()
  }
}
