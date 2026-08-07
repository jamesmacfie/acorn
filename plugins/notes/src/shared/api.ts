// The notes pane's route builders (docs/notes-and-memory.md), moved verbatim out of
// @acorn/protocol/api.ts.
//
// Read the paths: they are served under /v2/p/MEMORY, not /v2/p/notes. That is a real oddity, not a
// typo — notes owns the store (contract/store.ts) while plugins/memory owns the wire
// (plugins/memory/src/server/routes/knowledge.ts). It is carried over unchanged here on purpose,
// because straightening it is a wire change and this commit is a move. Do not "fix" the prefix
// without moving the server routes in the same breath, or every note read 404s.
import type { NoteLocation } from '@acorn/protocol/notes.ts'

// Existing workspace/global URLs stay stable; task scope adds its reserved subtree without moving
// persisted files. `global` remains the reserved workspace-key URL for compatibility.
export const notesListRoute = (location: NoteLocation) =>
  location.scope === 'task'
    ? `/v2/p/memory/tasks/${encodeURIComponent(location.taskId)}/notes`
    : `/v2/p/memory/workspaces/${encodeURIComponent(location.scope === 'global' ? 'global' : location.workspaceId)}/notes`
export const noteRoute = (location: NoteLocation, slug: string) => `${notesListRoute(location)}/${encodeURIComponent(slug)}`
export const noteIncludedRoute = (location: NoteLocation, slug: string) => `${noteRoute(location, slug)}/included`
export const noteTitleRoute = (location: NoteLocation, slug: string) => `${noteRoute(location, slug)}/title`
