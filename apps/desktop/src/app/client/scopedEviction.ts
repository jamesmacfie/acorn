import { clientEvents } from '@acorn/client-core/registries/clientEvents.ts'
import { evictScope } from '@acorn/client-core/registries/scopeEviction.ts'
import { dropNode } from '@acorn/client-core/node/fleet.ts'

// Maps runtime lifecycle events onto scope evictions. That is all it does now.
//
// It used to import ten evictors out of five plugins and call each one by hand, and its own comment
// admitted the problem: every new module signal had to remember to add itself here, and nothing
// enforced it. Forgetting was silent and looked like a data bug: node A's agent roster rendered under
// node B, against ids that may collide across nodes by construction
// (docs/architecture-overview.md § Client state and fleet behavior).
//
// Inverted: each state owner registers its own evictor beside the signal it clears
// (client-core/registries/scopeEviction.ts). The shell no longer knows, or needs to know, who is
// listening, which is also ten fewer deep imports into plugin internals.
export function activateScopedStateEviction(): () => void {
  const offTask = clientEvents.on('runtime:task-archived', ({ taskId }) => evictScope({ scope: 'task', taskId }))
  const offWorkspace = clientEvents.on('runtime:workspace-removed', ({ workspaceId }) =>
    evictScope({ scope: 'workspace', workspaceId }))
  // One call, where task-archival fans out to ten listeners. That is the per-node QueryClient paying
  // off: every piece of a node's cached data lives in that node's client and nowhere else, so there is
  // exactly one thing to drop.
  const offNode = clientEvents.on('runtime:node-removed', ({ nodeId }) => dropNode(nodeId))
  // And this is where that payoff stops. Feature state held in module-level signals sits outside the
  // QueryClient partition and survived a node switch. Only live rosters clear; durable per-task and
  // per-workspace memory is keyed by node instead, so switching back restores it.
  const offSwitch = clientEvents.on('runtime:node-switched', () => evictScope({ scope: 'node-switched' }))
  return () => {
    offSwitch()
    offNode()
    offWorkspace()
    offTask()
  }
}
