import { lazy } from 'solid-js'
import { libraryCollapsed } from './notesPaneState'
import { createNotesModel, type NotesModel } from './notesModel'
import type { PaneLayoutContribution } from '@acorn/plugin-api/client'

// Notes as a `list-detail` pane: the host draws the split, the divider and the drag handle, and these
// three components fill the regions (docs/panes.md § Layout model).
const NotesHeader = lazy(async () => ({ default: (await import('./NotesPane')).NotesHeader }))
const NotesList = lazy(async () => ({ default: (await import('./NotesPane')).NotesList }))
const NoteBody = lazy(async () => ({ default: (await import('./NotesPane')).NoteBody }))

export const notesPaneContribution: PaneLayoutContribution<NotesModel> = {
  id: 'notes', label: 'Notes', glyph: 'notepad-text', description: 'Workspace scratchpad', order: 30,
  defaultChord: 'meta+shift+d', requires: { plugin: 'notes' },
  layout: 'list-detail',
  // The selection, the note being edited and its autosave timer, held once per task by the host so
  // collapsing the library cannot take them with it (client-core registries/paneModels.ts).
  model: (task) => createNotesModel(task.id, task.projectId),
  regions: { 'list-header': NotesHeader, list: NotesList, detail: NoteBody },
  // Collapsing the library drops the column rather than narrowing it, which is what the ◀ in the note
  // toolbar has always meant.
  hidden: (task) => (libraryCollapsed(task.id) ? ['list'] : []),
}
