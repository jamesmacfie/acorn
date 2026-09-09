// The memory pane's route builders (docs/notes-and-memory.md), moved verbatim out of
// @acorn/protocol/api.ts so this plugin owns the shape of its own namespace.

export const memoryListRoute = (projectId?: string) => `/v2/p/memory/memory${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`
export const memorySearchRoute = (query: string, projectId?: string, type?: string) =>
  `/v2/p/memory/memory/search?q=${encodeURIComponent(query)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}${type ? `&type=${encodeURIComponent(type)}` : ''}`
export const memoryAddRoute = (taskId: string) => `/v2/p/memory/tasks/${taskId}/memory`
export const memoryProposalsRoute = (taskId?: string) => `/v2/p/memory/memory/proposals${taskId ? `?task=${encodeURIComponent(taskId)}` : ''}`
export const memoryResolveProposalRoute = (id: string) => `/v2/p/memory/memory/proposals/${encodeURIComponent(id)}/resolve`

// The Memory page's rail source id, named by both halves: the client registers the source under it
// (../client/proposalTarget.ts) and the node targets it from the proposal gate's bell row
// (../server/knowledgeChannel.ts). Core's `source` target kind answers it, so both hosts open the page
// without this plugin registering a handler for it.
export const MEMORY_SOURCE_ID = 'memory'
