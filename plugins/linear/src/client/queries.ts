// Linear's TanStack Query definitions. They live with the plugin that owns the routes and the keys
// (../shared/api.ts) rather than in client-core, so adding a provider does not mean editing core.
//
// Moved verbatim from @acorn/client-core/queries.ts — same keys, same staleTime, same refetch policy.
// `workspaceLinearIssuesKey`'s '-v2' suffix is load-bearing: it orphans persisted pre-redesign rows
// that would otherwise hydrate and crash the browse model.
import { readJson } from '@acorn/client-core/apiClient.ts'
import type { WorkspaceProject } from '@acorn/protocol/api.ts'
import { linearIssueKey, linearIssueRoute, linearProjectsKey, linearProjectsRoute, linearProjectIssuesRoute, type LinearIssueDetail, type LinearProjectsResponse, type LinearProjectIssuesResponse } from '../shared/api'

type QueryContext = { signal?: AbortSignal }

// Linear projects for the per-repo picker (Linear source). Cached 5 min — projects change rarely.
export const linearProjectsOptions = (enabled: boolean) => ({
  queryKey: linearProjectsKey,
  enabled,
  staleTime: 5 * 60 * 1000,
  queryFn: async ({ signal }: QueryContext): Promise<LinearProjectsResponse> => readJson<LinearProjectsResponse>(linearProjectsRoute, { signal }),
})

// All active issues for a workspace's linked Linear projects, which may span several connections.
// Groups the (integrationId, externalId) selection by integration and fans out one request each,
// merging the results. Each issue carries its integrationId (stamped server-side) for promotion.
// v2: LinearProjectIssue grew required labels/priority/updatedAt fields — the version suffix orphans
// persisted pre-redesign rows that would otherwise hydrate and crash the browse model.
export const workspaceLinearIssuesKey = (selection: WorkspaceProject[]) =>
  ['workspace-linear-issues-v2', ...selection.map((p) => `${p.integrationId}:${p.externalId}`).sort()] as const
export const workspaceLinearIssuesOptions = (selection: WorkspaceProject[], enabled: boolean) => ({
  queryKey: workspaceLinearIssuesKey(selection),
  enabled,
  refetchOnMount: 'always' as const,
  queryFn: async ({ signal }: QueryContext): Promise<LinearProjectIssuesResponse> => {
    const byIntegration = new Map<string, string[]>()
    for (const p of selection) byIntegration.set(p.integrationId, [...(byIntegration.get(p.integrationId) ?? []), p.externalId])
    const results = await Promise.all(
      [...byIntegration].map(([integrationId, ids]) => readJson<LinearProjectIssuesResponse>(linearProjectIssuesRoute(integrationId, ids), { signal })),
    )
    return { issues: results.flatMap((r) => r.issues) }
  },
})

// Full ticket detail for the side panel. refetchOnMount:'always' + staleTime 0 → opening the panel
// re-fetches (the route's ?refresh=1 forces a fresh Linear read and updates the cache).
export const linearIssueOptions = (identifier: string, enabled: boolean, connectionId?: string) => ({
  queryKey: linearIssueKey(identifier, connectionId),
  enabled,
  staleTime: 0,
  refetchOnMount: 'always' as const,
  queryFn: async ({ signal }: QueryContext): Promise<LinearIssueDetail> =>
    readJson<LinearIssueDetail>(linearIssueRoute(identifier, connectionId), { signal }),
})
