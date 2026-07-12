import { clientEvents, evictPendingIntents } from '../registries/clientEvents'
import { evictContextSelection } from '../../../plugins/context/client/selectionState'
import { evictSyncState } from '../../../plugins/context/client/syncState'
import { evictNotesPaneState } from '../../../plugins/notes/client/notesPaneState'
import { evictEditorState } from '../../../plugins/editor/client/editorState'
import { evictEditorViewStates } from '../../../plugins/editor/client/editorViewState'
import { evictPrFilter } from '../../../plugins/github/client/pullList/filterState'
import { evictActiveTerminal } from '../../../plugins/terminal/client/sessions'
import { evictTaskState, evictWorkspaceView } from '../tasks/tasks'

// Each owner exposes its own eviction operation; the core only maps lifecycle events to scopes.
// This keeps the event payload state-free and avoids introducing a general container abstraction.
export function activateScopedStateEviction(): () => void {
  const offTask = clientEvents.on('runtime:task-archived', ({ taskId }) => {
    evictTaskState(taskId)
    evictEditorState(taskId)
    evictEditorViewStates(taskId)
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
