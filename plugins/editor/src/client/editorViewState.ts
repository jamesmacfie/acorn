import { activeNodeId, onScopeEvicted } from '@acorn/plugin-api/client'
import type { EditorViewState } from '@acorn/plugin-api/ui/editor'

// Where the reader was in each open file. Selection and scroll, as data this plugin owns, rather
// than an editor library's opaque blob (docs/editor.md § View state).
const viewStates = new Map<string, EditorViewState>()
const viewKey = (taskId: string, path: string): string => `${activeNodeId() ?? ''}/${taskId}:${path}`

export const rememberEditorViewState = (taskId: string, path: string, state: EditorViewState): void => {
  viewStates.set(viewKey(taskId, path), state)
}

export const editorViewState = (taskId: string, path: string): EditorViewState | undefined =>
  viewStates.get(viewKey(taskId, path))

export function evictEditorViewStates(taskId: string): void {
  // Every node's entries for this task id, not just the active node's. Archival is final, and a key
  // left behind under another node's prefix is never reached again.
  const suffix = `/${taskId}:`
  for (const key of viewStates.keys()) if (key.includes(suffix)) viewStates.delete(key)
}

// Keyed by a node-minted task id; must not outlive a node switch (docs/state.md § Scope rules).
export function clearEditorViewStates(): void {
  viewStates.clear()
}

// Registered beside the signal it clears rather than in the shell's evictor list
// (docs/state.md § Scope rules).
onScopeEvicted((e) => {
  if (e.scope === 'task') evictEditorViewStates(e.taskId)
  else if (e.scope === 'node-switched') clearEditorViewStates()
})
