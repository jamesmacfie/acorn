import type { editor } from 'monaco-editor'
import { activeNodeId } from '@acorn/client-core/node/activeNode.ts'

const viewStates = new Map<string, editor.ICodeEditorViewState>()
const viewKey = (taskId: string, path: string): string => `${activeNodeId() ?? ''}/${taskId}:${path}`

export const rememberEditorViewState = (taskId: string, path: string, state: editor.ICodeEditorViewState): void => {
  viewStates.set(viewKey(taskId, path), state)
}

export const editorViewState = (taskId: string, path: string): editor.ICodeEditorViewState | undefined =>
  viewStates.get(viewKey(taskId, path))

export function evictEditorViewStates(taskId: string): void {
  // Every node's entries for this task id, not just the active node's: archival is final, and a key left
  // behind under another node's prefix would never be reached again.
  const suffix = `/${taskId}:`
  for (const key of viewStates.keys()) if (key.includes(suffix)) viewStates.delete(key)
}

// Same reason as clearEditorStates: keyed by a node-minted task id, must not outlive a node switch.
export function clearEditorViewStates(): void {
  viewStates.clear()
}
