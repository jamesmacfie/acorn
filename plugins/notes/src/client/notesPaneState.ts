// Notes pane view state (docs/notes-and-memory.md § Notes): which note you were on per task. The
// shared list-detail layout owns sidebar collapse, including its device-local persistence. Selection
// is session-only and is evicted on task archive.
import type { NoteScope } from '@acorn/protocol/notes.ts'
import { activeNodeId, onScopeEvicted } from '@acorn/plugin-api/client'

export type NotesSelection = { scope: NoteScope; slug: string }

const key = (taskId: string, nodeId: string | null): string => JSON.stringify([nodeId, taskId])
const selectedByTask = new Map<string, NotesSelection>()
export const notesSelectionFor = (taskId: string, nodeId: string | null = activeNodeId()): NotesSelection | undefined => selectedByTask.get(key(taskId, nodeId))
export const rememberNotesSelection = (taskId: string, selection: NotesSelection, nodeId: string | null = activeNodeId()): void => {
  selectedByTask.set(key(taskId, nodeId), selection)
}

export function evictNotesPaneState(taskId: string, nodeId: string | null = activeNodeId()): void {
  selectedByTask.delete(key(taskId, nodeId))
}

// Registered here rather than listed in the shell's evictor file, so this signal and the thing that
// clears it are one edit apart (registries/scopeEviction.ts states the full argument).
onScopeEvicted((e) => {
  if (e.scope === 'task') evictNotesPaneState(e.taskId)
})
