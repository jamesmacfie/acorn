import type { MemoryAddress, MemoryChange, MemoryDocument, MemoryVersion, MemoryPreview, MemoryCaps, MemoryImportSource, MemoryImportFile, MemoryImportResult } from '../shared/api'
import { memoryAddRoute, memoryListRoute, memoryProjectAddRoute, memorySearchRoute, memoryUndoRoute, memoryPageRoute } from '../shared/api'
import { readJson, writeJson } from '@acorn/plugin-api/client'
import type { MemoryRow, MemoryType } from '../contract/library'
export type { MemoryRow, MemoryType } from '../contract/library'

// The memory words every surface shares: the page, the palette, and the transcript card.
export const MEMORY_TYPE_LABEL: Record<MemoryType, string> = {
  project: 'Project', convention: 'Convention', architecture: 'Architecture', decision: 'Decision', fix: 'Fix',
  reference: 'Reference', feedback: 'Feedback', task: 'Task', user: 'About you',
}
export const MEMORY_TYPE_OPTIONS = (['user', 'feedback', 'project', 'reference'] as MemoryType[]).map((value) => ({ value, label: MEMORY_TYPE_LABEL[value] }))
export const MEMORY_SCOPE_LABEL: Record<'project' | 'private', string> = { project: 'This project', private: 'All projects' }
// Documents and versions carry the type as a plain string, and an older file may hold any word.
export const memoryTypeLabel = (type: string): string => MEMORY_TYPE_LABEL[type as MemoryType] ?? type
export const MEMORY_ACTION_LABEL: Record<MemoryChange['action'], string> = { write: 'Saved', delete: 'Deleted', restore: 'Restored' }
// A change's `by`, or a file's `updatedBy`, which writes an agent as `agent:<session>`.
export const memoryAuthorLabel = (by: string | undefined): string =>
  by?.startsWith('agent') ? 'An agent' : by === 'import' ? 'Import' : 'You'
// With the time, unlike most dates in the app: one memory's versions are often minutes apart.
export const memoryDate = (at: string | number): string =>
  new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export type MemoryApi = {
  list(projectId?: string): Promise<MemoryRow[] | { error: string }>
  search(query: string, projectId?: string, type?: MemoryType): Promise<(MemoryRow & { rank: number })[] | { error: string }>
  add(p: { taskId?: string; projectId?: string; scope: 'project' | 'private'; name: string; description: string; type: MemoryType; body: string }): Promise<{ path: string } | { error: string }>
  undo(changeId: string): Promise<unknown>
  get(address: MemoryAddress, projectId?: string): Promise<MemoryDocument | null>
  history(address: MemoryAddress, projectId?: string): Promise<MemoryVersion[]>
  edit(address: MemoryAddress, input: { name: string; description: string; type: string; body: string; hash: string }, scope: 'project' | 'private', projectId?: string): Promise<unknown>
  delete(address: MemoryAddress, hash: string, projectId?: string): Promise<unknown>
  restore(address: MemoryAddress, version: string, hash: string | undefined, projectId?: string): Promise<unknown>
  changes(projectId?: string): Promise<(MemoryChange & { canUndo: boolean })[]>
  preview(projectId?: string): Promise<MemoryPreview>
  caps(caps: MemoryCaps, projectId?: string): Promise<unknown>
  sources(projectId: string): Promise<MemoryImportSource[]>
  importPreview(projectId: string, sourceId: string): Promise<MemoryImportFile[]>
  import(projectId: string, sourceId: string, files: { name: string; sourceHash: string; destinationHash: string | null; overwrite: boolean }[]): Promise<MemoryImportResult>
}

const post = <T>(url: string, body?: unknown) =>
  writeJson<T>(url, { method: 'POST', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

const page = <T>(action: string, projectId: string | undefined, request: unknown = {}) => post<T>(memoryPageRoute(action, projectId), request)
const api: MemoryApi = {
  get: (address, projectId) => page('get', projectId, { address }),
  history: (address, projectId) => page('history', projectId, { address }),
  edit: (address, input, scope, projectId) => page('edit', projectId, { address, input, scope }),
  delete: (address, hash, projectId) => page('delete', projectId, { address, hash }),
  restore: (address, version, hash, projectId) => page('restore', projectId, { address, version, hash }),
  changes: (projectId) => page('changes', projectId, { scope: 'project' }),
  preview: (projectId) => page('preview', projectId, { scope: 'project' }),
  caps: (caps, projectId) => page('caps', projectId, { caps }),
  sources: (projectId) => page('sources', projectId),
  importPreview: (projectId, sourceId) => page('import-preview', projectId, { sourceId }),
  import: (projectId, sourceId, files) => page('import', projectId, { sourceId, files }),
  list: (projectId) => readJson<MemoryRow[] | { error: string }>(memoryListRoute(projectId, 'project')),
  search: (query, projectId, type) => readJson<(MemoryRow & { rank: number })[] | { error: string }>(memorySearchRoute(query, projectId, type, 'project')),
  add: (p) => post<{ path: string } | { error: string }>(p.taskId ? memoryAddRoute(p.taskId) : memoryProjectAddRoute(p.projectId ?? ''), { scope: p.scope, name: p.name, description: p.description, type: p.type, body: p.body }),
  undo: (changeId) => post<unknown>(memoryUndoRoute(changeId)),
}

export const memoryApi = (): MemoryApi => api
