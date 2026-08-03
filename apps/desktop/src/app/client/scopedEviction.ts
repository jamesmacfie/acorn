import { clientEvents, evictPendingIntents } from '@acorn/client-core/registries/clientEvents.ts'
import { dropNode } from '@acorn/client-core/node/fleet.ts'
import { evictContextSelection } from '@acorn/plugin-context/client/selectionState.ts'
import { evictSyncState } from '@acorn/plugin-context/client/syncState.ts'
import { evictNotesPaneState } from '@acorn/plugin-notes/client/notesPaneState.ts'
import { evictEditorState } from '@acorn/plugin-editor/client/editorState.ts'
import { evictEditorTreeState } from '@acorn/plugin-editor/client/editorTreeState.ts'
import { evictEditorViewStates } from '@acorn/plugin-editor/client/editorViewState.ts'
import { evictPrFilter } from '@acorn/plugin-github/client/pullList/filterState.ts'
import { evictReviewViewStates } from '@acorn/plugin-github/client/reviewViewState.ts'
import { evictActiveTerminal } from '@acorn/client-core/tasks/agentSessions.ts'
import { evictTaskState, evictWorkspaceView } from '@acorn/client-core/tasks/tasks.ts'

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
  return () => {
    offNode()
    offWorkspace()
    offTask()
  }
}
