// The memory pane's route builders (docs/notes-and-memory.md), moved verbatim out of
// @acorn/protocol/api.ts so this plugin owns the shape of its own namespace.

export const memoryListRoute = (projectId?: string) => `/v2/p/memory/memory${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`
export const memorySearchRoute = (query: string, projectId?: string, type?: string) =>
  `/v2/p/memory/memory/search?q=${encodeURIComponent(query)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}${type ? `&type=${encodeURIComponent(type)}` : ''}`
export const memoryAddRoute = (taskId: string) => `/v2/p/memory/tasks/${taskId}/memory`
export const memoryProposalsRoute = (taskId?: string) => `/v2/p/memory/memory/proposals${taskId ? `?task=${encodeURIComponent(taskId)}` : ''}`
export const memoryResolveProposalRoute = (id: string) => `/v2/p/memory/memory/proposals/${encodeURIComponent(id)}/resolve`
