import { activeNodeId, nodeReady, readJson, writeJson } from '@acorn/plugin-api/client'
import { remotesRoute, type RemoteChange, type RemoteChangeResult, type RemoteRoster } from '../shared/api'

export const remotesKey = (projectId: string) => ['git-remotes', activeNodeId(), projectId] as const
export const remotesOptions = (projectId: string) => ({
  queryKey: remotesKey(projectId), queryFn: ({ signal }: { signal: AbortSignal }) => readJson<RemoteRoster>(remotesRoute(projectId), { signal }),
  enabled: nodeReady() && !!projectId, staleTime: 10_000,
})
export const changeRemote = (projectId: string, request: RemoteChange) => writeJson<RemoteChangeResult>(remotesRoute(projectId), {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
})
