// The changes plugin's wire contract: the working-tree review pane and its acorn-owned inline notes.
//
// Types, route builders and the query key together, following the docker/http convention — the plugin
// that owns the namespace owns the shape of what crosses it. Moved verbatim out of
// @acorn/protocol/api.ts: route strings and the query key are byte-identical, because the persisted
// query cache has no buster and a changed key value would orphan a user's IndexedDB.

// Local review notes (docs/panes.md): inline annotations on uncommitted changes, acorn-owned.
export type ReviewNote = {
  id: string
  taskId: string
  path: string
  side: 'additions' | 'deletions'
  startLine: number
  endLine: number
  snippet: string | null
  body: string
  sentAt: number | null // stamped on delivery; cleared on edit
  createdAt: number
}
export type ReviewNoteSeed = Pick<ReviewNote, 'path' | 'side' | 'startLine' | 'endLine' | 'body'> & { snippet?: string | null }

export const reviewNotesRoute = (taskId: string) => `/v2/p/changes/tasks/${taskId}/review-notes`
export const reviewNoteRoute = (taskId: string, noteId: string) => `/v2/p/changes/tasks/${taskId}/review-notes/${noteId}`
export const reviewNotesSentRoute = (taskId: string) => `/v2/p/changes/tasks/${taskId}/review-notes/sent`
export const reviewNotesKey = (taskId: string) => ['review-notes', taskId] as const

// Local-changes review (docs/panes.md): working-tree status/diff/blob + stage/commit/discard/push.
// Was the `local:*` IPC channels.
export const localChangesRoute = (taskId: string) => `/v2/p/changes/tasks/${taskId}/local/changes`
export const localDiffRoute = (taskId: string, path: string, scope: 'unstaged' | 'staged') =>
  `/v2/p/changes/tasks/${taskId}/local/diff?path=${encodeURIComponent(path)}&scope=${scope}`
export const localBlobRoute = (taskId: string, path: string, ref?: string) =>
  `/v2/p/changes/tasks/${taskId}/local/blob?path=${encodeURIComponent(path)}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`
export const localActionRoute = (taskId: string, action: 'stage' | 'unstage' | 'discard' | 'commit' | 'stage-all' | 'unstage-all' | 'discard-all' | 'push') =>
  `/v2/p/changes/tasks/${taskId}/local/${action}`
