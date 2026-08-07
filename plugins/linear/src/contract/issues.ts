// The one Linear read another plugin makes: plugins/github enriches a PR's referenced tickets on the
// detail view. It lives in contract/ rather than client/queries.ts because contract/ is the sanctioned
// cross-plugin surface (docs/plugins.md § Package shape) — the arch suite fails a plugin->plugin import
// anywhere else, which is how this file came to exist.
//
// It reads from ../shared/api and client-core only, never from this plugin's own client/, so the
// transitive contract-purity rule holds.
import { writeJson } from '@acorn/client-core/apiClient.ts'
import { linearIssuesKey, linearIssuesRoute, type LinearIssuesRequest, type LinearIssuesResponse } from '../shared/api'

export type { LinearIssueState, LinearIssueSummary, LinearIssuesResponse } from '../shared/api'

type QueryContext = { signal?: AbortSignal }

// Batch enrichment for the Integrations list (title + status per referenced ticket). The client caches
// the server's provider-backed response for five minutes. Returns only the issues Linear resolved.
export const linearIssuesOptions = (identifiers: string[], enabled: boolean) => ({
  queryKey: linearIssuesKey(identifiers),
  enabled,
  staleTime: 5 * 60 * 1000,
  // Always re-check on mount so the list self-heals from a stale or empty persisted cache.
  refetchOnMount: 'always' as const,
  queryFn: async ({ signal }: QueryContext): Promise<LinearIssuesResponse> =>
    writeJson<LinearIssuesResponse>(
      linearIssuesRoute,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifiers } satisfies LinearIssuesRequest), signal },
      'linear_issues_failed',
    ),
})
