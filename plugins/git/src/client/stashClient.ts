import { activeNodeId, nodeReady, readJson, writeJson } from '@acorn/plugin-api/client'
import { stashesRoute, type StashApply, type StashCreate, type StashDrop, type StashResult, type StashRoster } from '../shared/api'

export const stashesKey = (projectId: string) => ['git-stashes', activeNodeId(), projectId] as const
export const stashesOptions = (projectId: string) => ({
  queryKey: stashesKey(projectId),
  queryFn: ({ signal }: { signal: AbortSignal }) => readJson<StashRoster>(stashesRoute(projectId), { signal }),
  enabled: nodeReady() && !!projectId,
  staleTime: 10_000,
})
const post = (url: string, body: unknown) => writeJson<StashResult>(url,
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
export const stashActions = {
  create: (projectId: string, request: StashCreate) => post(stashesRoute(projectId), request),
  apply: (projectId: string, request: StashApply) => post(`${stashesRoute(projectId)}/apply`, request),
  pop: (projectId: string, request: StashApply) => post(`${stashesRoute(projectId)}/pop`, request),
  drop: (projectId: string, request: StashDrop) => post(`${stashesRoute(projectId)}/drop`, request),
}
