// Editor session state: open-file tabs per task (ephemeral preview slot, dirty flags, active
// file), persisted to the 'editor_open_files' pref so relaunch restores the tabs (see
// docs/state.md § Scope rules for why open files live in Node prefs). Dirty flags reset on reload
// since content itself is not persisted. Pure list ops plus a thin signal store, like tasks.ts.
import { createSignal } from 'solid-js'
import { onScopeEvicted, openPane } from '@acorn/plugin-api/client'

export type OpenFile = { path: string; ephemeral: boolean; dirty: boolean }

// Open, or focus, a file. Ephemeral opens reuse the single preview slot (verne's model): the
// previous ephemeral tab is replaced unless it is dirty, since an edit already promoted it in
// spirit and should stay.
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

// An edit marks the file dirty and promotes an ephemeral tab; editing a preview keeps it open.
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
export type TaskEditorState = { files: OpenFile[]; active: string | null }
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

export function evictEditorState(taskId: string): void {
  setByTask((current) => {
    if (!(taskId in current)) return current
    const next = { ...current }
    delete next[taskId]
    return next
  })
}

export const requestEditorReveal = (taskId: string, path: string, line: number, column?: number): void => {
  const position = column === undefined ? { line } : { line, column }
  openPane(taskId, 'editor', { kind: 'editor:reveal', path, ...position }, 'add')
}

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

export function hydrateTaskEditorState(taskId: string, state: TaskEditorState): void {
  setByTask((current) => (current[taskId]?.files.length ? current : { ...current, [taskId]: state }))
}

export { byTask as editorStateByTask }

// Every map here is keyed by a node-minted task id and must not survive a node switch
// (docs/state.md § Scope rules): the persistence pass used to write each scope under the active
// node's storage key, which let one node's state leak into another's namespace.
export function clearEditorStates(): void {
  setByTask({})
}

// Registered beside the signal it clears rather than in the shell's evictor list
// (docs/state.md § Scope rules).
onScopeEvicted((e) => {
  if (e.scope === 'task') evictEditorState(e.taskId)
  else if (e.scope === 'node-switched') clearEditorStates()
})
