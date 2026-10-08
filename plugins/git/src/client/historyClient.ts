import { activeNodeId, nodeReady, readJson, writeJson } from '@acorn/plugin-api/client'
import type { DiffSearchPage, DiffSearchRequest, DiffSegmentPayload, DiffSegmentRequest } from '@acorn/plugin-api/ui/diff'
import { historyRoute, revisionRoute, type HistoryFilter, type HistoryPage, type RevisionDetail } from '../shared/api'

const post = <T>(url: string, body: unknown, signal?: AbortSignal) => writeJson<T>(url,
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal })
export const historyKey = (projectId: string, filter: HistoryFilter) => ['git-history', activeNodeId(), projectId, filter.ref, filter.field, filter.query] as const
export const revisionKey = (projectId: string, id: string, base?: string | null) => ['git-revision', activeNodeId(), projectId, id, base] as const
export const historyOptions = (projectId: string, filter: HistoryFilter, cursor: string | null = null) => ({
  queryKey: [...historyKey(projectId, filter), cursor],
  queryFn: ({ signal }: { signal: AbortSignal }) => {
    const search = new URLSearchParams({ field: filter.field, query: filter.query })
    if (filter.ref) search.set('ref', filter.ref)
    if (cursor) search.set('cursor', cursor)
    return readJson<HistoryPage>(`${historyRoute(projectId)}?${search}`, { signal })
  }, enabled: nodeReady() && !!projectId, staleTime: 10_000, gcTime: 30_000,
})
export const revisionOptions = (projectId: string, id: string, base?: string | null) => {
  const nodeId = activeNodeId()
  return {
    queryKey: revisionKey(projectId, id, base),
    queryFn: async ({ signal }: { signal: AbortSignal }) => ({ nodeId, projectId, id, requestedBase: base,
      detail: await readJson<RevisionDetail>(`${revisionRoute(projectId, id)}${base === undefined ? '' : `?base=${base ?? ''}`}`, { signal }) }),
    enabled: nodeReady() && !!projectId && !!id, staleTime: 60_000, gcTime: 30_000,
  }
}
export const revisionApi = {
  segments: (projectId: string, id: string, base: string | null, requests: DiffSegmentRequest[], signal: AbortSignal) =>
    post<DiffSegmentPayload[]>(`${revisionRoute(projectId, id)}/segments`, { base, requests }, signal),
  search: (projectId: string, id: string, base: string | null, request: DiffSearchRequest, signal: AbortSignal) =>
    post<DiffSearchPage>(`${revisionRoute(projectId, id)}/search`, { base, ...request }, signal),
  file: (projectId: string, id: string, base: string | null, path: string, sha: string, signal: AbortSignal) =>
    post<{ text: string }>(`${revisionRoute(projectId, id)}/file`, { base, path, sha }, signal),
}
