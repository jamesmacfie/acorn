// The notes pane's route builders (docs/notes-and-memory.md), moved verbatim out of
// @acorn/protocol/api.ts.
//
// Notes owns the current wire surface under /v2/p/notes. The memory plugin keeps the old
// /v2/p/memory/* paths as a compatibility alias for one release.
import type { NoteLocation } from '@acorn/protocol/notes.ts'

// Existing workspace/global URLs stay stable; task scope adds its reserved subtree without moving
// persisted files. `global` remains the reserved workspace-key URL for compatibility.
export const notesListRoute = (location: NoteLocation) =>
  location.scope === 'task'
    ? `/v2/p/notes/tasks/${encodeURIComponent(location.taskId)}/notes`
    : `/v2/p/notes/workspaces/${encodeURIComponent(location.scope === 'global' ? 'global' : location.workspaceId)}/notes`
export const noteRoute = (location: NoteLocation, slug: string) => `${notesListRoute(location)}/${encodeURIComponent(slug)}`
export const noteIncludedRoute = (location: NoteLocation, slug: string) => `${noteRoute(location, slug)}/included`
export const noteTitleRoute = (location: NoteLocation, slug: string) => `${noteRoute(location, slug)}/title`
