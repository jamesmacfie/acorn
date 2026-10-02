import { memoryAddRoute, memoryListRoute, memoryProjectAddRoute, memorySearchRoute, memoryUndoRoute } from '../shared/api'
import { readJson, writeJson } from '@acorn/plugin-api/client'
import type { MemoryRow, MemoryType } from '../contract/library'
export type { MemoryRow, MemoryType } from '../contract/library'

// Shared type and scope labels for the add form and Memory page.
export const MEMORY_TYPE_LABEL: Record<MemoryType, string> = {
  project: 'Project', convention: 'Convention', architecture: 'Architecture', decision: 'Decision', fix: 'Fix',
  reference: 'Reference', feedback: 'Feedback', task: 'Task', user: 'About you',
}
export const MEMORY_TYPE_OPTIONS = (['user', 'feedback', 'project', 'reference'] as MemoryType[]).map((value) => ({ value, label: MEMORY_TYPE_LABEL[value] }))
export const MEMORY_SCOPE_LABEL: Record<'project' | 'private', string> = { project: 'This project', private: 'All projects' }
export const MEMORY_SCOPE_OPTIONS = (['project', 'private'] as const).map((value) => ({ value, label: MEMORY_SCOPE_LABEL[value] }))

export type MemoryApi = {
  list(projectId?: string): Promise<MemoryRow[] | { error: string }>
  search(query: string, projectId?: string, type?: MemoryType): Promise<(MemoryRow & { rank: number })[] | { error: string }>
  add(p: { taskId?: string; projectId?: string; scope: 'project' | 'private'; name: string; description: string; type: MemoryType; body: string }): Promise<{ path: string } | { error: string }>
  undo(changeId: string): Promise<unknown>
}

const post = <T>(url: string, body?: unknown) =>
  writeJson<T>(url, { method: 'POST', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

const api: MemoryApi = {
  list: (projectId) => readJson<MemoryRow[] | { error: string }>(memoryListRoute(projectId)),
  search: (query, projectId, type) => readJson<(MemoryRow & { rank: number })[] | { error: string }>(memorySearchRoute(query, projectId, type)),
  add: (p) => post<{ path: string } | { error: string }>(p.taskId ? memoryAddRoute(p.taskId) : memoryProjectAddRoute(p.projectId ?? ''), { scope: p.scope, name: p.name, description: p.description, type: p.type, body: p.body }),
  undo: (changeId) => post<unknown>(memoryUndoRoute(changeId)),
}

export const memoryApi = (): MemoryApi => api
