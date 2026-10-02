// The memory pane's route builders (docs/notes-and-memory.md), moved verbatim out of
// @acorn/protocol/api.ts so this plugin owns the shape of its own namespace.

export const memoryListRoute = (projectId?: string) => `/v1/p/memory/memory${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`
export const memorySearchRoute = (query: string, projectId?: string, type?: string) =>
  `/v1/p/memory/memory/search?q=${encodeURIComponent(query)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}${type ? `&type=${encodeURIComponent(type)}` : ''}`
export const memoryAddRoute = (taskId: string) => `/v1/p/memory/tasks/${taskId}/memory`
export const memoryProjectAddRoute = (projectId: string) => `/v1/p/memory/projects/${encodeURIComponent(projectId)}/memory`
export const memoryUndoRoute = (changeId: string) => `/v1/p/memory/memory/changes/${encodeURIComponent(changeId)}/undo`
export const memoryApproveFindingRoute = (id: string) => `/v1/p/memory/memory/findings/${encodeURIComponent(id)}/approve`

// (../client/proposalTarget.ts) and the node targets it from the proposal gate's bell row
// (../server/knowledgeChannel.ts). Core's `source` target kind answers it, so both hosts open the page
// without this plugin registering a handler for it.
export const MEMORY_SOURCE_ID = 'memory'
