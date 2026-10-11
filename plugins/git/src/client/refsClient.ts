import { activeNodeId, nodeReady, readJson, writeJson } from '@acorn/plugin-api/client'
import { refsRoute, type RefChange, type RefChangeResult, type RefRoster } from '../shared/api'

export const refsKey = (projectId: string) => ['git-refs', activeNodeId(), projectId] as const
export const refsOptions = (projectId: string) => ({
  queryKey: refsKey(projectId),
  queryFn: ({ signal }: { signal: AbortSignal }) => readJson<RefRoster>(refsRoute(projectId), { signal }),
  enabled: nodeReady() && !!projectId,
  staleTime: 10_000,
})
export const changeRef = (projectId: string, request: RefChange) =>
  writeJson<RefChangeResult>(refsRoute(projectId), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })
