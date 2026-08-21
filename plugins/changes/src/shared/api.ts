// The changes plugin's wire contract: the working-tree review pane and its inline notes.
//
// Types, route builders and the query key live together, following the docker and http
// convention: the plugin that owns the namespace owns the shape of what crosses it. Moved verbatim
// out of @acorn/protocol/api.ts with routes and the query key byte-identical; see docs/caching.md
// for why a changed key would orphan a user's IndexedDB.

// Inline annotations on uncommitted changes, owned by this plugin rather than mirrored from GitHub.
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

// Local-changes review: working-tree status, diff and blob reads, plus stage, commit, discard and
// push. Replaced the `local:*` IPC channels.
export const localChangesRoute = (taskId: string) => `/v2/p/changes/tasks/${taskId}/local/changes`
export const localDiffRoute = (taskId: string, path: string, scope: 'unstaged' | 'staged') =>
  `/v2/p/changes/tasks/${taskId}/local/diff?path=${encodeURIComponent(path)}&scope=${scope}`
export const localBlobRoute = (taskId: string, path: string, ref?: string) =>
  `/v2/p/changes/tasks/${taskId}/local/blob?path=${encodeURIComponent(path)}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`
export const localActionRoute = (taskId: string, action: 'stage' | 'unstage' | 'discard' | 'commit' | 'stage-all' | 'unstage-all' | 'discard-all' | 'push') =>
  `/v2/p/changes/tasks/${taskId}/local/${action}`
