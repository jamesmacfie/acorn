import type { editor } from 'monaco-editor'
import { activeNodeId } from '@acorn/client-core/node/activeNode.ts'

// Session-only scroll/cursor/selection state. Kept outside the TSX component so lifecycle eviction
// can clear it without importing the Monaco rendering surface.
//
// The key carries the NODE as of Phase 4. Task ids are node-minted UUIDs and two nodes may hold the same one
// (architecture.md § Fleet semantics), so without it a remote task's editor would restore the scroll position
// of a local task that happened to share an id. Keyed rather than cleared on a node switch, so switching away
// and back returns you to where you were reading.
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
