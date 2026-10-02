import { activeNodeId, onScopeEvicted } from '@acorn/plugin-api/client'
import type { EditorViewState } from '@acorn/plugin-api/ui/editor'

// Where the reader was in each open file. Selection and scroll, as data this plugin owns, rather
// than an editor library's opaque blob (docs/editor.md § View state).
const viewStates = new Map<string, EditorViewState>()
const viewKey = (taskId: string, path: string, nodeId: string | null): string => `${nodeId ?? ''}/${taskId}:${path}`

export const rememberEditorViewState = (taskId: string, path: string, state: EditorViewState, nodeId = activeNodeId()): void => {
  viewStates.set(viewKey(taskId, path, nodeId), state)
}

export const editorViewState = (taskId: string, path: string, nodeId = activeNodeId()): EditorViewState | undefined =>
  viewStates.get(viewKey(taskId, path, nodeId))

export const forgetEditorViewState = (taskId: string, path: string, nodeId = activeNodeId()): void => {
  viewStates.delete(viewKey(taskId, path, nodeId))
}

export function evictEditorViewStates(taskId: string, nodeId = activeNodeId()): void {
  // A matching task ID on another Node has independent view state.
  const suffix = `${nodeId ?? ''}/${taskId}:`
  for (const key of viewStates.keys()) if (key.startsWith(suffix)) viewStates.delete(key)
}

// Test reset; ordinary Node switches retain independently keyed view state.
export function clearEditorViewStates(): void {
  viewStates.clear()
}

// Registered beside the signal it clears rather than in the shell's evictor list
// (docs/state.md § Scope rules).
onScopeEvicted((e) => {
  if (e.scope === 'task') evictEditorViewStates(e.taskId)
})
