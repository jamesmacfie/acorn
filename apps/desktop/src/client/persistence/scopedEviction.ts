import { clientEvents, evictPendingIntents } from '../registries/clientEvents'
import { evictEditorState } from '../features/editor/editorState'
import { evictEditorViewStates } from '../features/editor/editorViewState'
import { evictPrFilter } from '../features/pullList/filterState'
import { evictActiveTerminal } from '../features/terminal/sessions'
import { evictTaskState, evictWorkspaceView } from '../features/tasks/tasks'

// Each owner exposes its own eviction operation; the core only maps lifecycle events to scopes.
// This keeps the event payload state-free and avoids introducing a general container abstraction.
export function activateScopedStateEviction(): () => void {
  const offTask = clientEvents.on('runtime:task-archived', ({ taskId }) => {
    evictTaskState(taskId)
    evictEditorState(taskId)
    evictEditorViewStates(taskId)
    evictActiveTerminal(taskId)
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
