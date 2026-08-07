import { clientEvents, evictPendingIntents } from '@acorn/client-core/registries/clientEvents.ts'
import { dropNode } from '@acorn/client-core/node/fleet.ts'
import { clearContextSelections, evictContextSelection } from '@acorn/plugin-context/client/selectionState.ts'
import { evictSyncState } from '@acorn/plugin-context/client/syncState.ts'
import { evictNotesPaneState } from '@acorn/plugin-notes/client/notesPaneState.ts'
import { clearEditorStates, evictEditorState } from '@acorn/plugin-editor/client/editorState.ts'
import { clearEditorTreeStates, evictEditorTreeState } from '@acorn/plugin-editor/client/editorTreeState.ts'
import { clearEditorViewStates, evictEditorViewStates } from '@acorn/plugin-editor/client/editorViewState.ts'
import { clearPrFilters, evictPrFilter } from '@acorn/plugin-github/client/pullList/filterState.ts'
import { evictReviewViewStates } from '@acorn/plugin-github/client/reviewViewState.ts'
import { clearSessions, evictActiveTerminal } from '@acorn/client-core/tasks/agentSessions.ts'
import { clearNodePlugins } from '@acorn/client-core/node/nodePlugins.ts'
import { managedAgentStore } from '@acorn/plugin-agents/client/managedStore.ts'
import { clearNodeScopedTaskState, evictTaskState, evictWorkspaceView } from '@acorn/client-core/tasks/tasks.ts'

// Each owner exposes its own eviction operation; this only maps lifecycle events to scopes. It lives
// in app/ because choosing the concrete set of state owners is composition, not a core concern — that
// keeps the event payload state-free and avoids a general container abstraction in core.
export function activateScopedStateEviction(): () => void {
  const offTask = clientEvents.on('runtime:task-archived', ({ taskId }) => {
    evictTaskState(taskId)
    evictEditorState(taskId)
    evictEditorTreeState(taskId)
    evictEditorViewStates(taskId)
    evictReviewViewStates(taskId)
    evictActiveTerminal(taskId)
    evictContextSelection(taskId)
    evictSyncState(taskId)
    evictNotesPaneState(taskId)
    evictPendingIntents(taskId)
  })
  const offWorkspace = clientEvents.on('runtime:workspace-removed', ({ workspaceId }) => {
    evictWorkspaceView(workspaceId)
    evictPrFilter(workspaceId)
  })
  // ONE evictor, where task-archival needs ten. That is the per-node QueryClient paying off: every
  // piece of a node's cached data lives in that node's client and nowhere else, so there is exactly one
  // thing to drop and no per-plugin evictor to forget when a plugin is added.
  const offNode = clientEvents.on('runtime:node-removed', ({ nodeId }) => dropNode(nodeId))
  // …and this is where that payoff STOPS. The QueryClient partition covers cached queries; feature state
  // held in module-level signals sits outside it and survived a node switch, so node A's agent roster,
  // terminal sessions and plugin list were rendered under node B — against ids that may collide across
  // nodes by construction (docs/architecture-overview.md § Fleet semantics).
  //
  // Only the LIVE rosters are cleared. They are refetched for the new node within a tick, so clearing
  // costs nothing and keying by node would buy nothing. Durable per-workspace and per-task memory
  // (viewByWorkspace, editor scroll, the active terminal tab) is the opposite case: it should be KEYED by
  // node so switching back restores it, which is where those keys gained a nodeId rather than a clear.
  const offSwitch = clientEvents.on('runtime:node-switched', () => {
    // The live rosters: refetched for the new node within a tick, so clearing costs nothing.
    clearSessions()
    managedAgentStore.clear()
    clearNodePlugins()
    clearNodeScopedTaskState()
    clearEditorStates()
    clearEditorTreeStates()
    clearEditorViewStates()
    clearPrFilters()
    clearContextSelections()
  })
  return () => {
    offSwitch()
    offNode()
    offWorkspace()
    offTask()
  }
}
