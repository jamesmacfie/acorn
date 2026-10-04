// The memory pane's route builders (docs/notes-and-memory.md), moved verbatim out of
// @acorn/protocol/api.ts so this plugin owns the shape of its own namespace.

export const memoryListRoute = (projectId?: string, scope?: 'project' | 'private') => `/v1/p/memory/memory${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}${scope ? `${projectId ? '&' : '?'}scope=${scope}` : ''}`
export const memorySearchRoute = (query: string, projectId?: string, type?: string, scope?: 'project' | 'private') =>
  `/v1/p/memory/memory/search?q=${encodeURIComponent(query)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}${type ? `&type=${encodeURIComponent(type)}` : ''}${scope ? `&scope=${scope}` : ''}`
export const memoryAddRoute = (taskId: string) => `/v1/p/memory/tasks/${taskId}/memory`
export const memoryProjectAddRoute = (projectId: string) => `/v1/p/memory/projects/${encodeURIComponent(projectId)}/memory`
export const memoryUndoRoute = (changeId: string) => `/v1/p/memory/memory/changes/${encodeURIComponent(changeId)}/undo`

export const MEMORY_SOURCE_ID = 'memory'

export type MemoryAddress = { scope: 'project' | 'private'; projectId: string | null; name: string }
export type MemoryAuthor = { by: 'agent' | 'owner' | 'import'; sessionId?: string; taskId?: string }
export type MemoryChange = MemoryAddress & MemoryAuthor & {
  id: string; at: string; action: 'write' | 'delete' | 'restore'; previousVersion: string | null; hash: string | null
}
export type MemoryVersion = { version: string; at: string; updatedBy: string; body: string; name: string; description: string; type: string }
export type MemoryDocument = MemoryAddress & { hash: string; body: string; description: string; type: string; updatedAt?: number; updatedBy?: string; taskId?: string; sessionId?: string }
export type MemoryCaps = { private: number; project: number }
export type MemoryPreview = { text: string; caps: MemoryCaps; counts: MemoryCaps; shown: MemoryCaps }
export type MemoryImportSource = { id: string; label: string; path: string }
export type MemoryImportFile = { file: string; name: string; description: string; type: string; body: string; sourceHash: string; destinationHash: string | null; collision: boolean; error?: string }
export type MemoryImportResult = { imported: string[]; skipped: string[]; errors: { name: string; error: string }[] }
export const memoryPageRoute = (action: string, projectId?: string) => `/v1/p/memory/library/${action}${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`
