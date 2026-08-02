import { clientEvents, evictPendingIntents } from '@acorn/client-core/registries/clientEvents.ts'
import { evictContextSelection } from '../../plugins/context/client/selectionState'
import { evictSyncState } from '../../plugins/context/client/syncState'
import { evictNotesPaneState } from '../../plugins/notes/client/notesPaneState'
import { evictEditorState } from '../../plugins/editor/client/editorState'
import { evictEditorTreeState } from '../../plugins/editor/client/editorTreeState'
import { evictEditorViewStates } from '../../plugins/editor/client/editorViewState'
import { evictPrFilter } from '../../plugins/github/client/pullList/filterState'
import { evictReviewViewStates } from '../../plugins/github/client/reviewViewState'
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
  return () => {
    offWorkspace()
    offTask()
  }
}
