// Notes pane view state (docs/notes-and-memory.md § Notes): which note you were on per task. The
// shared list-detail layout owns sidebar collapse, including its device-local persistence. Selection
// is session-only and is evicted on task archive.
import type { NoteScope } from '@acorn/protocol/notes.ts'
import { onScopeEvicted } from '@acorn/plugin-api/client'

export type NotesSelection = { scope: NoteScope; slug: string }

const selectedByTask = new Map<string, NotesSelection>()
export const notesSelectionFor = (taskId: string): NotesSelection | undefined => selectedByTask.get(taskId)
export const rememberNotesSelection = (taskId: string, selection: NotesSelection): void => {
  selectedByTask.set(taskId, selection)
}

export function evictNotesPaneState(taskId: string): void {
  selectedByTask.delete(taskId)
}

// Registered here rather than listed in the shell's evictor file, so this signal and the thing that
// clears it are one edit apart (registries/scopeEviction.ts states the full argument).
onScopeEvicted((e) => {
  if (e.scope === 'task') evictNotesPaneState(e.taskId)
})
