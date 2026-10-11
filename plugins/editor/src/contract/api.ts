// The editor plugin's wire contract: find-in-files plus the worktree read/write/list routes.
//
// Lives in contract/, not shared/, because plugins/agents' @-mention textarea reads
// `editorFilesRoute` from here (docs/plugins/package-shape.md § Package shape).

// Find-in-files: POST because it spawns ripgrep and the query is an arbitrary body, not a path
// segment.
export const searchRoute = (taskId: string) => `/v1/p/editor/tasks/${taskId}/search`

// Editor pane: read, write, and list worktree files. relPath rides a query param so a nested path
// never collides with the route segments.
export type EditorEntry = {
  name: string
  dir: boolean
  kind?: 'file' | 'folder' | 'link'
  identity?: string
  entryId?: string
  root?: string
}
export type IgnoreEntries = { available: true; ignored: string[] } | { available: false; ignored: []; reason: string }
export type FileEntryKind = 'file' | 'folder' | 'link'
export type FileTarget = { path: string; kind: FileEntryKind; identity: string; entryId: string; root: string }
export type FileActionResult = { ok: true; path: string } | { ok: false; reason: string; partial?: boolean }
export type TrashAvailability = { available: boolean; reason?: string }
export type EditorReadResult = { text: string; revision: string }
export type EditorWriteResult =
  | { ok: true; text: string; revision: string }
  | { ok: false; kind: 'conflict' | 'deleted' | 'failure'; reason: string }
export const editorRootRoute = (taskId: string) => `/v1/p/editor/tasks/${taskId}/editor/root`
export const editorFilesRoute = (taskId: string) => `/v1/p/editor/tasks/${taskId}/editor/files`
export const editorFileStatusRoute = (taskId: string) => `/v1/p/editor/tasks/${taskId}/editor/file-status`
export const editorListRoute = (taskId: string, relPath: string) =>
  `/v1/p/editor/tasks/${taskId}/editor/list?path=${encodeURIComponent(relPath)}`
export const editorIgnoredRoute = (taskId: string) => `/v1/p/editor/tasks/${taskId}/editor/ignored`
export const editorReadRoute = (taskId: string, relPath: string) =>
  `/v1/p/editor/tasks/${taskId}/editor/read?path=${encodeURIComponent(relPath)}`
export const editorImageRoute = (taskId: string, relPath: string) =>
  `/v1/p/editor/tasks/${taskId}/editor/image?path=${encodeURIComponent(relPath)}`
export const editorLineMarkersRoute = (taskId: string, relPath: string, revision?: string) =>
  `/v1/p/editor/tasks/${taskId}/editor/line-markers?path=${encodeURIComponent(relPath)}${revision === undefined ? '' : `&revision=${encodeURIComponent(revision)}`}`
export const editorWriteRoute = (taskId: string) => `/v1/p/editor/tasks/${taskId}/editor/file`
export const editorEntryRoute = (taskId: string, relPath: string) =>
  `/v1/p/editor/tasks/${taskId}/editor/entry?path=${encodeURIComponent(relPath)}`
export const editorCreateRoute = (taskId: string) => `/v1/p/editor/tasks/${taskId}/editor/create`
export const editorRenameRoute = (taskId: string) => `/v1/p/editor/tasks/${taskId}/editor/rename`
export const editorRenameAvailabilityRoute = (taskId: string) =>
  `/v1/p/editor/tasks/${taskId}/editor/rename-availability`
export const editorTrashRoute = (taskId: string) => `/v1/p/editor/tasks/${taskId}/editor/trash`
export const editorTrashAvailabilityRoute = (taskId: string) => `/v1/p/editor/tasks/${taskId}/editor/trash-availability`

export type { EditorLineMarkerSnapshot } from './lineMarkers'
