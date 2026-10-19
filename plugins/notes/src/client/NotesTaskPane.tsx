import { lazy } from 'solid-js'
import { createNotesModel, type NotesModel } from './notesModel'
import type { PaneLayoutContribution } from '@acorn/plugin-api/client'

// Notes as a `list-detail` pane: the host draws the split, the divider and the drag handle, and these
// three components fill the regions (docs/panes/layout.md § Layout model).
const NotesHeader = lazy(async () => ({ default: (await import('./NotesPane')).NotesHeader }))
const NotesList = lazy(async () => ({ default: (await import('./NotesPane')).NotesList }))
const NoteBody = lazy(async () => ({ default: (await import('./NotesPane')).NoteBody }))

export const notesPaneContribution: PaneLayoutContribution<NotesModel> = {
  id: 'notes',
  label: 'Notes',
  glyph: 'notepad-text',
  description: 'Task and shared notes',
  order: 30,
  defaultChord: 'meta+shift+d',
  requires: { plugin: 'notes' },
  layout: 'list-detail',
  // The selection, the note being edited and its autosave timer, held once per task by the host so
  // collapsing the library cannot take them with it (client-core's `paneModel`).
  model: (task, pane) => createNotesModel(task.id, task.projectId, pane.shown),
  regions: { 'list-header': NotesHeader, list: NotesList, detail: NoteBody },
  collapsible: true,
  collapseContent: 'empty',
  // Notes are files under the data root, not in the worktree, so they outlive an archive.
  readsArchived: true,
}
