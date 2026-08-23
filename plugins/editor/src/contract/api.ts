// The editor plugin's wire contract: find-in-files plus the worktree read/write/list routes.
//
// Lives in contract/, not shared/, because plugins/agents' @-mention textarea reads
// `editorFilesRoute` from here (docs/plugins.md § Package shape).

// Find-in-files: POST because it spawns ripgrep and the query is an arbitrary body, not a path
// segment.
export const searchRoute = (taskId: string) => `/v2/p/editor/tasks/${taskId}/search`

// Editor pane: read, write, and list worktree files. relPath rides a query param so a nested path
// never collides with the route segments.
export type EditorEntry = { name: string; dir: boolean }
export type EditorWriteResult = { ok: boolean; reason?: string }
export const editorRootRoute = (taskId: string) => `/v2/p/editor/tasks/${taskId}/editor/root`
export const editorFilesRoute = (taskId: string) => `/v2/p/editor/tasks/${taskId}/editor/files`
export const editorListRoute = (taskId: string, relPath: string) => `/v2/p/editor/tasks/${taskId}/editor/list?path=${encodeURIComponent(relPath)}`
export const editorReadRoute = (taskId: string, relPath: string) => `/v2/p/editor/tasks/${taskId}/editor/read?path=${encodeURIComponent(relPath)}`
export const editorWriteRoute = (taskId: string) => `/v2/p/editor/tasks/${taskId}/editor/file`
