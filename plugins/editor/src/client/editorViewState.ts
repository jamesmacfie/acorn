import { activeNodeId, onScopeEvicted } from '@acorn/plugin-api/client'
import type { EditorViewState } from '@acorn/plugin-api/ui/editor'
import { movedPath, pathContains } from './editorState'

// Where the reader was in each open file. Selection and scroll, as data this plugin owns, rather
// than an editor library's opaque blob (docs/editor/document-surface.md § View state).
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

export function moveEditorViewStates(taskId: string, from: string, to: string, nodeId = activeNodeId()): void {
  const prefix = `${nodeId ?? ''}/${taskId}:`
  for (const [key, state] of [...viewStates]) {
    if (!key.startsWith(prefix)) continue
    const path = key.slice(prefix.length)
    if (!pathContains(from, path)) continue
    viewStates.delete(key)
    viewStates.set(viewKey(taskId, movedPath(path, from, to), nodeId), state)
  }
}

export function removeEditorViewStates(taskId: string, path: string, nodeId = activeNodeId()): void {
  const prefix = `${nodeId ?? ''}/${taskId}:`
  for (const key of viewStates.keys()) if (key.startsWith(prefix) && pathContains(path, key.slice(prefix.length))) viewStates.delete(key)
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
// (docs/state-ownership/scope-rules.md § Scope rules).
onScopeEvicted((e) => {
  if (e.scope === 'task') evictEditorViewStates(e.taskId)
})
