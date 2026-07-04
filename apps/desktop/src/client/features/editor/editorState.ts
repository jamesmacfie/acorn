// Editor session state (docs/next 07): open-file tabs per task — ephemeral preview slot, dirty
// flags, active file — persisted to the 'editor_open_files' pref so relaunch restores the tabs
// (dirty resets: content isn't persisted). Pure list ops + a thin signal store, like tasks.ts.
import { createSignal } from 'solid-js'

export type OpenFile = { path: string; ephemeral: boolean; dirty: boolean }

// Open (or focus) a file. Ephemeral opens reuse the single preview slot (verne's model): the
// previous ephemeral tab is replaced unless it's dirty (an edit promoted it in spirit — keep it).
export function openFileIn(list: OpenFile[], path: string, ephemeral: boolean): OpenFile[] {
  const existing = list.find((f) => f.path === path)
  if (existing) {
    // Re-opening a preview tab non-ephemerally promotes it.
    if (!ephemeral && existing.ephemeral) return list.map((f) => (f.path === path ? { ...f, ephemeral: false } : f))
    return list
  }
  const next = ephemeral ? list.filter((f) => !f.ephemeral || f.dirty) : [...list]
  return [...next, { path, ephemeral, dirty: false }]
}

export function promoteFile(list: OpenFile[], path: string): OpenFile[] {
  return list.some((f) => f.path === path && f.ephemeral) ? list.map((f) => (f.path === path ? { ...f, ephemeral: false } : f)) : list
}

export function closeFile(list: OpenFile[], path: string): OpenFile[] {
  return list.filter((f) => f.path !== path)
}

// An edit both marks dirty AND promotes an ephemeral tab (editing a preview keeps it).
export function setFileDirty(list: OpenFile[], path: string, dirty: boolean): OpenFile[] {
  return list.map((f) => (f.path === path ? { ...f, dirty, ephemeral: dirty ? false : f.ephemeral } : f))
}

// Pick the next active path after closing `closed` (the neighbour, VS Code-style).
export function nextActive(list: OpenFile[], closed: string, current: string | null): string | null {
  if (current !== closed) return current
  const i = list.findIndex((f) => f.path === closed)
  const rest = list.filter((f) => f.path !== closed)
  if (!rest.length) return null
  return (rest[Math.min(i, rest.length - 1)] ?? rest[rest.length - 1]).path
}

// --- Signal store ---
type TaskEditorState = { files: OpenFile[]; active: string | null }
const [byTask, setByTask] = createSignal<Record<string, TaskEditorState>>({})

const stateFor = (taskId: string): TaskEditorState => byTask()[taskId] ?? { files: [], active: null }
export const openFiles = (taskId: string): OpenFile[] => stateFor(taskId).files
export const activeFile = (taskId: string): string | null => stateFor(taskId).active

function update(taskId: string, fn: (s: TaskEditorState) => TaskEditorState): void {
  setByTask((prev) => ({ ...prev, [taskId]: fn(prev[taskId] ?? { files: [], active: null }) }))
}

export const editorOpen = (taskId: string, path: string, ephemeral: boolean): void =>
  update(taskId, (s) => ({ files: openFileIn(s.files, path, ephemeral), active: path }))
export const editorPromote = (taskId: string, path: string): void => update(taskId, (s) => ({ ...s, files: promoteFile(s.files, path) }))
export const editorClose = (taskId: string, path: string): void =>
  update(taskId, (s) => ({ files: closeFile(s.files, path), active: nextActive(s.files, path, s.active) }))
export const editorSetDirty = (taskId: string, path: string, dirty: boolean): void =>
  update(taskId, (s) => ({ ...s, files: setFileDirty(s.files, path, dirty) }))
export const editorActivate = (taskId: string, path: string): void => update(taskId, (s) => ({ ...s, active: path }))

// --- Persistence (prefs 'editor_open_files') ---
export function serializeEditorState(): string {
  const out: Record<string, { files: { path: string; ephemeral: boolean }[]; active: string | null }> = {}
  for (const [taskId, s] of Object.entries(byTask())) {
    if (s.files.length) out[taskId] = { files: s.files.map((f) => ({ path: f.path, ephemeral: f.ephemeral })), active: s.active }
  }
  return JSON.stringify(out)
}

export function hydrateEditorState(json: string | undefined): void {
  if (!json) return
  try {
    const raw = JSON.parse(json) as Record<string, { files?: { path?: unknown; ephemeral?: unknown }[]; active?: unknown }>
    if (!raw || typeof raw !== 'object') return
    setByTask((prev) => {
      const next = { ...prev }
      for (const [taskId, s] of Object.entries(raw)) {
        if (next[taskId]?.files.length) continue // never clobber live state
        const files = (Array.isArray(s.files) ? s.files : [])
          .filter((f): f is { path: string; ephemeral?: unknown } => !!f && typeof f.path === 'string' && !!f.path)
          .map((f) => ({ path: f.path, ephemeral: f.ephemeral === true, dirty: false }))
        if (files.length) next[taskId] = { files, active: typeof s.active === 'string' && files.some((f) => f.path === s.active) ? s.active : files[0].path }
      }
      return next
    })
  } catch {
    // malformed blob → fresh
  }
}

export { byTask as editorStateByTask }
