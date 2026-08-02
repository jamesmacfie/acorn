import type { editor } from 'monaco-editor'

// Session-only scroll/cursor/selection state. Kept outside the TSX component so lifecycle eviction
// can clear it without importing the Monaco rendering surface.
const viewStates = new Map<string, editor.ICodeEditorViewState>()
const viewKey = (taskId: string, path: string): string => `${taskId}:${path}`

export const rememberEditorViewState = (taskId: string, path: string, state: editor.ICodeEditorViewState): void => {
  viewStates.set(viewKey(taskId, path), state)
}

export const editorViewState = (taskId: string, path: string): editor.ICodeEditorViewState | undefined =>
  viewStates.get(viewKey(taskId, path))

export function evictEditorViewStates(taskId: string): void {
  const prefix = `${taskId}:`
  for (const key of viewStates.keys()) if (key.startsWith(prefix)) viewStates.delete(key)
}
