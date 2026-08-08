import { createSignal } from 'solid-js'
import { onScopeEvicted } from '@acorn/plugin-api/client'

// Session-only expanded-directory state, scoped to the task whose worktree the tree represents.
// Keeping this outside EditorPane lets pane/task navigation unmount the lazy tree without losing
// the user's place. Collapsing a parent deliberately retains its descendants, so reopening it
// restores the nested expansion exactly as it was.
const [expandedByTask, setExpandedByTask] = createSignal<ReadonlyMap<string, ReadonlySet<string>>>(new Map())

export const editorTreeDirectoryOpen = (taskId: string, path: string): boolean =>
  expandedByTask().get(taskId)?.has(path) ?? false

export function setEditorTreeDirectoryOpen(taskId: string, path: string, open: boolean): void {
  setExpandedByTask((current) => {
    const expanded = new Set(current.get(taskId) ?? [])
    if (open) expanded.add(path)
    else expanded.delete(path)

    const next = new Map(current)
    if (expanded.size) next.set(taskId, expanded)
    else next.delete(taskId)
    return next
  })
}

export function evictEditorTreeState(taskId: string): void {
  setExpandedByTask((current) => {
    if (!current.has(taskId)) return current
    const next = new Map(current)
    next.delete(taskId)
    return next
  })
}

// Same reason as clearEditorStates: keyed by a node-minted task id, must not outlive a node switch.
export function clearEditorTreeStates(): void {
  setExpandedByTask(new Map())
}

// Registered here rather than listed in the shell's evictor file, so this signal and the thing that
// clears it are one edit apart (registries/scopeEviction.ts states the full argument).
onScopeEvicted((e) => {
  if (e.scope === 'task') evictEditorTreeState(e.taskId)
  else if (e.scope === 'node-switched') clearEditorTreeStates()
})
