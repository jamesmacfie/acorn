import { createSignal } from 'solid-js'
import { activeNodeId, onScopeEvicted } from '@acorn/plugin-api/client'
import { movedPath, pathContains } from './editorState'

// Session-only expanded-directory state, scoped to the task whose worktree the tree represents.
// Keeping this outside EditorPane lets pane and task navigation unmount the lazy tree without
// losing the user's place. Collapsing a parent retains its descendants, so reopening it restores
// the nested expansion exactly as it was.
const [expandedByTask, setExpandedByTask] = createSignal<ReadonlyMap<string, ReadonlySet<string>>>(new Map())
const ownerKey = (taskId: string, nodeId: string | null): string => JSON.stringify([nodeId, taskId])
export const editorTreeCollectionId = (taskId: string, nodeId: string | null): string =>
  `editor.file-tree:${ownerKey(taskId, nodeId)}`

// Only a mounted tree can admit a captured palette target. The narrow lookup reads its
// current visible folders; it carries neither retained roving state nor a service bag.
const folderOwners = new Map<string, (path: string) => boolean>()
export function registerEditorTreeFolders(
  taskId: string,
  nodeId: string | null,
  contains: (path: string) => boolean,
): () => void {
  const key = ownerKey(taskId, nodeId)
  folderOwners.set(key, contains)
  return () => {
    if (folderOwners.get(key) === contains) folderOwners.delete(key)
  }
}
export function captureEditorTreeFolder(
  taskId: string,
  nodeId: string | null,
  path: string,
): (() => boolean) | undefined {
  const key = ownerKey(taskId, nodeId)
  const contains = folderOwners.get(key)
  if (!contains?.(path)) return undefined
  return () => folderOwners.get(key) === contains && contains(path)
}

export const editorTreeDirectoryOpen = (taskId: string, path: string, nodeId = activeNodeId()): boolean =>
  expandedByTask().get(ownerKey(taskId, nodeId))?.has(path) ?? false

export function setEditorTreeDirectoryOpen(taskId: string, path: string, open: boolean, nodeId = activeNodeId()): void {
  setExpandedByTask((current) => {
    const key = ownerKey(taskId, nodeId)
    const expanded = new Set(current.get(key) ?? [])
    if (open) expanded.add(path)
    else expanded.delete(path)

    const next = new Map(current)
    if (expanded.size) next.set(key, expanded)
    else next.delete(key)
    return next
  })
}

export function collapseEditorTreeDirectories(taskId: string, nodeId = activeNodeId()): void {
  setExpandedByTask((current) => {
    const next = new Map(current)
    next.delete(ownerKey(taskId, nodeId))
    return next
  })
}

export function moveEditorTreeDirectories(taskId: string, from: string, to: string, nodeId = activeNodeId()): void {
  setExpandedByTask((current) => {
    const key = ownerKey(taskId, nodeId)
    const expanded = current.get(key)
    if (!expanded) return current
    const next = new Map(current)
    next.set(key, new Set([...expanded].map((path) => movedPath(path, from, to))))
    return next
  })
}

export function removeEditorTreeDirectories(taskId: string, path: string, nodeId = activeNodeId()): void {
  setExpandedByTask((current) => {
    const key = ownerKey(taskId, nodeId)
    const expanded = current.get(key)
    if (!expanded) return current
    const next = new Map(current)
    const remaining = new Set([...expanded].filter((entry) => !pathContains(path, entry)))
    if (remaining.size) next.set(key, remaining)
    else next.delete(key)
    return next
  })
}

export function evictEditorTreeState(taskId: string, nodeId = activeNodeId()): void {
  folderOwners.delete(ownerKey(taskId, nodeId))
  setExpandedByTask((current) => {
    const key = ownerKey(taskId, nodeId)
    if (!current.has(key)) return current
    const next = new Map(current)
    next.delete(key)
    return next
  })
}

// Expanded paths are session state for their captured Node and task.
export function clearEditorTreeStates(): void {
  folderOwners.clear()
  setExpandedByTask(new Map())
}

// Registered beside the signal it clears rather than in the shell's evictor list
// (docs/state-ownership/scope-rules.md § Scope rules).
onScopeEvicted((e) => {
  if (e.scope === 'task') evictEditorTreeState(e.taskId)
})
