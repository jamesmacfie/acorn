// The memory pane's route builders (docs/notes-and-memory.md), moved verbatim out of
// @acorn/protocol/api.ts so this plugin owns the shape of its own namespace.

export const memoryListRoute = (repo?: string) => `/v2/p/memory/memory${repo ? `?repo=${encodeURIComponent(repo)}` : ''}`
export const memorySearchRoute = (query: string, repo?: string, type?: string) =>
  `/v2/p/memory/memory/search?q=${encodeURIComponent(query)}${repo ? `&repo=${encodeURIComponent(repo)}` : ''}${type ? `&type=${encodeURIComponent(type)}` : ''}`
export const memoryAddRoute = (taskId: string) => `/v2/p/memory/tasks/${taskId}/memory`
export const memoryProposalsRoute = (taskId?: string) => `/v2/p/memory/memory/proposals${taskId ? `?task=${encodeURIComponent(taskId)}` : ''}`
export const memoryResolveProposalRoute = (id: string) => `/v2/p/memory/memory/proposals/${encodeURIComponent(id)}/resolve`
