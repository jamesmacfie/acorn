// The notes pane's route builders (docs/notes-and-memory.md), moved verbatim out of
// @acorn/protocol/api.ts.
//
// Notes owns the wire surface under /v1/p/notes.
import type { NoteLocation } from '@acorn/protocol/notes.ts'

// Existing workspace/global URLs stay stable; task scope adds its reserved subtree without moving
// persisted files. `global` remains the reserved workspace-key URL for compatibility.
export const notesListRoute = (location: NoteLocation) =>
  location.scope === 'task'
    ? `/v1/p/notes/tasks/${encodeURIComponent(location.taskId)}/notes`
    : `/v1/p/notes/workspaces/${encodeURIComponent(location.scope === 'global' ? 'global' : location.workspaceId)}/notes`
export const noteRoute = (location: NoteLocation, slug: string) => `${notesListRoute(location)}/${encodeURIComponent(slug)}`
export const noteIncludedRoute = (location: NoteLocation, slug: string) => `${noteRoute(location, slug)}/included`
export const noteTitleRoute = (location: NoteLocation, slug: string) => `${noteRoute(location, slug)}/title`
