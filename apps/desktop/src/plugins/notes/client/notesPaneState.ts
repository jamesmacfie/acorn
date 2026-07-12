// Notes pane view state (docs/next/context-ui.md): which note you were on and whether the library
// column is collapsed, per task. Session-only (matches the house session-first guidance — only the
// Manifest's section selection has a stated durability requirement). Evicted on task archive.
import { createSignal } from 'solid-js'
import type { NoteScope } from '../../../core/shared/notes'

export type NotesSelection = { scope: NoteScope; slug: string }

const selectedByTask = new Map<string, NotesSelection>()
export const notesSelectionFor = (taskId: string): NotesSelection | undefined => selectedByTask.get(taskId)
export const rememberNotesSelection = (taskId: string, selection: NotesSelection): void => {
  selectedByTask.set(taskId, selection)
}

// Reactive so the ◀ toggle re-lays out immediately; the map is the session-persistence backing.
const [collapsed, setCollapsed] = createSignal<Record<string, boolean>>({})
export const libraryCollapsed = (taskId: string): boolean => collapsed()[taskId] ?? false
export const setLibraryCollapsed = (taskId: string, value: boolean): void => {
  setCollapsed((current) => ({ ...current, [taskId]: value }))
}

export function evictNotesPaneState(taskId: string): void {
  selectedByTask.delete(taskId)
  setCollapsed((current) => {
    if (!(taskId in current)) return current
    const next = { ...current }
    delete next[taskId]
    return next
  })
}
