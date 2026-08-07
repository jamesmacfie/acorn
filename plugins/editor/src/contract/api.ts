// The editor plugin's wire contract: find-in-files plus the worktree read/write/list routes.
//
// In contract/ rather than shared/ because plugins/agents' @-mention textarea reads
// `editorFilesRoute` to complete a path, and contract/ is the one sanctioned cross-plugin surface
// (docs/plugins.md § Package shape). Moved verbatim out of @acorn/protocol/api.ts — a retyped route
// template compiles fine and 404s at runtime.

// Find-in-files (docs/panes.md): POST because it spawns ripgrep and the query is arbitrary body,
// not a path segment. Was the `search:findInFiles` IPC channel.
export const searchRoute = (taskId: string) => `/v2/p/editor/tasks/${taskId}/search`

// Editor pane (docs/workspaces-and-tasks.md): read/write/list worktree files. Was the `editor:*` IPC channels.
// relPath rides a query param so a nested path never collides with the route segments.
export type EditorEntry = { name: string; dir: boolean }
export type EditorWriteResult = { ok: boolean; reason?: string }
export const editorRootRoute = (taskId: string) => `/v2/p/editor/tasks/${taskId}/editor/root`
export const editorFilesRoute = (taskId: string) => `/v2/p/editor/tasks/${taskId}/editor/files`
export const editorListRoute = (taskId: string, relPath: string) => `/v2/p/editor/tasks/${taskId}/editor/list?path=${encodeURIComponent(relPath)}`
export const editorReadRoute = (taskId: string, relPath: string) => `/v2/p/editor/tasks/${taskId}/editor/read?path=${encodeURIComponent(relPath)}`
export const editorWriteRoute = (taskId: string) => `/v2/p/editor/tasks/${taskId}/editor/file`
