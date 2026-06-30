// Shared TanStack Query definitions. Two consumers each (dropdown + PR list both read repos),
// so the options live here to avoid drift. All reads are same-origin cookie-auth; 401 on /me
// is a valid logged-out state, elsewhere it's an error.
import { readJson, writeJson } from './apiClient'
import {
  branchesKey,
  branchesRoute,
  compareKey,
  compareRoute,
  fileBlobKey,
  fileBlobRoute,
  filePatchKey,
  filePatchRoute,
  filePatchesRoute,
  fileSummariesKey,
  fileSummariesRoute,
  filesKey,
  integrationsKey,
  integrationsRoute,
  linearIssueKey,
  linearIssueRoute,
  linearIssuesKey,
  linearIssuesRoute,
  linearProjectsKey,
  linearProjectsRoute,
  linearProjectIssuesKey,
  linearProjectIssuesRoute,
  meKey,
  meRoute,
  mentionsKey,
  mentionsRoute,
  jobLogKey,
  jobLogRoute,
  runJobsKey,
  runJobsRoute,
  pinsKey,
  pinsRoute,
  prefsKey,
  prefsRoute,
  closedPullsKey,
  closedPullsRoute,
  pullKey,
  pullRoute,
  pullsKey,
  pullsRoute,
  repoLabelsKey,
  repoLabelsRoute,
  reposKey,
  reposRoute,
  workspacesKey,
  workspacesRoute,
  type Workspace,
  type Branch,
  type ClosedPullsPage,
  type Compare,
  type FileBlob,
  type IntegrationsStatus,
  type JobLog,
  type LinearIssueDetail,
  type LinearIssuesRequest,
  type LinearIssuesResponse,
  type LinearProjectsResponse,
  type LinearProjectIssuesResponse,
  type Me,
  type Pull,
  type RunJobs,
  type Label,
  type PullDetail,
  type PullFile,
  type PullFilesPatchRequest,
  type Repo,
} from '../shared/api'

export {
  filePatchKey,
  fileSummariesKey,
  integrationsKey,
  linearIssueKey,
  meKey,
  pinsKey,
  prefsKey,
  pullKey,
  pullPrefixKey,
  repoLabelsKey,
  pullsKey,
  pullsRoute,
  pullsPrefixKey,
  reposKey,
  reposRefreshRoute,
  workspacesKey,
} from '../shared/api'
export type { Branch, Check, Comment, Compare, CompareCommit, IntegrationsStatus, Label, LinearActivity, LinearComment, LinearIssueDetail, LinearIssueState, LinearIssueSummary, Me, Pull, PullCommit, PullDetail, PullFile, Repo, Review, Thread, ThreadComment, Workspace, WorkspaceLink, WorkspaceSeed } from '../shared/api'

type QueryContext = { signal?: AbortSignal }
type PageQueryContext = QueryContext & { pageParam: number }

export const meOptions = () => ({
  queryKey: meKey,
  queryFn: async ({ signal }: QueryContext): Promise<Me | null> => readJson<Me | null>(meRoute, { nullOn401: true, signal }),
})

export const reposOptions = (enabled: boolean) => ({
  queryKey: reposKey,
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<Repo[]> => readJson<Repo[]>(reposRoute, { signal }),
})

export const pullsOptions = (owner: string, repo: string, state: 'open' | 'closed', enabled: boolean) => ({
  queryKey: pullsKey(owner, repo, state),
  enabled,
  refetchInterval: 60_000,
  queryFn: async ({ signal }: QueryContext): Promise<Pull[]> => readJson<Pull[]>(pullsRoute(owner, repo, state), { signal }),
})

// Closed PRs paginate on demand: one GitHub page per fetch, load-more advances pageParam.
export const closedPullsInfiniteOptions = (owner: string, repo: string, enabled: boolean) => ({
  queryKey: closedPullsKey(owner, repo),
  enabled,
  initialPageParam: 1,
  queryFn: async ({ pageParam, signal }: PageQueryContext): Promise<ClosedPullsPage> =>
    readJson<ClosedPullsPage>(closedPullsRoute(owner, repo, pageParam), { signal }),
  getNextPageParam: (last: ClosedPullsPage) => last.nextPage ?? undefined,
})

export const pullDetailOptions = (owner: string, repo: string, number: string, enabled: boolean) => ({
  queryKey: pullKey(owner, repo, number),
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<PullDetail> => readJson<PullDetail>(pullRoute(owner, repo, number), { signal }),
})

export const repoLabelsOptions = (owner: string, repo: string, enabled: boolean) => ({
  queryKey: repoLabelsKey(owner, repo),
  enabled,
  staleTime: 5 * 60 * 1000,
  queryFn: async ({ signal }: QueryContext): Promise<Label[]> => readJson<Label[]>(repoLabelsRoute(owner, repo), { signal }),
})

export const pinsOptions = (enabled: boolean) => ({
  queryKey: pinsKey,
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<number[]> => readJson<number[]>(pinsRoute, { signal }),
})

// Active workspaces for the rail (docs/workspaces P1). Source of truth is us; refetch on focus
// keeps the dirty/PR-inherited markers fresh as the mirror syncs.
export const workspacesOptions = (enabled: boolean) => ({
  queryKey: workspacesKey,
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<Workspace[]> => readJson<Workspace[]>(workspacesRoute, { signal }),
})

export const prefsOptions = (enabled: boolean) => ({
  queryKey: prefsKey,
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<Record<string, string>> => readJson<Record<string, string>>(prefsRoute, { signal }),
})

export const filesOptions = (owner: string, repo: string, number: string, enabled: boolean) => ({
  queryKey: filesKey(owner, repo, number),
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<PullFile[]> => readJson<PullFile[]>(pullRoute(owner, repo, number, 'files'), { signal }),
})

export const fileSummariesOptions = (owner: string, repo: string, number: string, enabled: boolean) => ({
  queryKey: fileSummariesKey(owner, repo, number),
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<PullFile[]> => readJson<PullFile[]>(fileSummariesRoute(owner, repo, number), { signal }),
})

export const filePatchOptions = (owner: string, repo: string, number: string, path: string) => ({
  queryKey: filePatchKey(owner, repo, number, path),
  queryFn: async ({ signal }: QueryContext): Promise<PullFile> => {
    const [file] = await readJson<PullFile[]>(filePatchRoute(owner, repo, number, path), { signal })
    if (!file) throw new Error('file_not_found')
    return file
  },
})

export const fetchFilePatches = (owner: string, repo: string, number: string, paths: string[], signal?: AbortSignal): Promise<PullFile[]> =>
  writeJson<PullFile[]>(
    filePatchesRoute(owner, repo, number),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths } satisfies PullFilesPatchRequest),
      signal,
    },
    'files_patch_failed',
  )

// Branch names for the create-PR pickers; enabled once the repo is known.
export const branchesOptions = (owner: string, repo: string, enabled: boolean) => ({
  queryKey: branchesKey(owner, repo),
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<Branch[]> => readJson<Branch[]>(branchesRoute(owner, repo), { signal }),
})

// base..head compare for the create view (diff preview + commits for title prefill).
export const compareOptions = (owner: string, repo: string, base: string, head: string, enabled: boolean) => ({
  queryKey: compareKey(owner, repo, base, head),
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<Compare> => readJson<Compare>(compareRoute(owner, repo, base, head), { signal }),
})

// Full head-blob body, fetched on demand (queryClient.fetchQuery) when a gap is expanded. The sha
// is immutable so the body never goes stale — fetch once per file, reuse for every gap.
export const fileBlobOptions = (owner: string, repo: string, sha: string) => ({
  queryKey: fileBlobKey(owner, repo, sha),
  staleTime: Infinity,
  queryFn: async ({ signal }: QueryContext): Promise<FileBlob> => readJson<FileBlob>(fileBlobRoute(owner, repo, sha), { signal }),
})

// Distinct participant logins for the repo — used to populate @mention autocomplete.
export const mentionsOptions = (owner: string, repo: string, enabled: boolean) => ({
  queryKey: mentionsKey(owner, repo),
  enabled,
  staleTime: 5 * 60 * 1000,
  queryFn: async ({ signal }: QueryContext): Promise<string[]> => readJson<string[]>(mentionsRoute(owner, repo), { signal }),
})

// Workflow run's jobs + steps for the checks panel. Short staleTime since running jobs change.
export const runJobsOptions = (owner: string, repo: string, runId: number, enabled: boolean) => ({
  queryKey: runJobsKey(owner, repo, runId),
  enabled,
  staleTime: 15_000,
  queryFn: async ({ signal }: QueryContext): Promise<RunJobs> => readJson<RunJobs>(runJobsRoute(owner, repo, runId), { signal }),
})

// One job's full log. staleTime Infinity: a completed job's log is immutable. ponytail: a still-
// running job's log going stale is the accepted ceiling (manual refresh is a later add).
export const jobLogOptions = (owner: string, repo: string, jobId: number, enabled: boolean) => ({
  queryKey: jobLogKey(owner, repo, jobId),
  enabled,
  staleTime: Infinity,
  queryFn: async ({ signal }: QueryContext): Promise<JobLog> => readJson<JobLog>(jobLogRoute(owner, repo, jobId), { signal }),
})

// Integration connection status (gates the Integrations section + settings). 401 → logged out.
export const integrationsOptions = (enabled: boolean) => ({
  queryKey: integrationsKey,
  enabled,
  staleTime: 5 * 60 * 1000,
  queryFn: async ({ signal }: QueryContext): Promise<IntegrationsStatus | null> =>
    readJson<IntegrationsStatus | null>(integrationsRoute, { nullOn401: true, signal }),
})

// Batch enrichment for the Integrations list (title + status per referenced ticket). Server
// serves-then-revalidates from D1; client caches 5 min. Returns only the issues Linear resolved.
export const linearIssuesOptions = (identifiers: string[], enabled: boolean) => ({
  queryKey: linearIssuesKey(identifiers),
  enabled,
  staleTime: 5 * 60 * 1000,
  // Always re-check on mount so the list self-heals from a stale/empty persisted cache; the
  // server's 10-min D1 cache keeps this cheap (serves cached title/status without hitting Linear).
  refetchOnMount: 'always' as const,
  queryFn: async ({ signal }: QueryContext): Promise<LinearIssuesResponse> =>
    writeJson<LinearIssuesResponse>(
      linearIssuesRoute,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifiers } satisfies LinearIssuesRequest), signal },
      'linear_issues_failed',
    ),
})

// Linear projects for the per-repo picker (Linear source). Cached 5 min — projects change rarely.
export const linearProjectsOptions = (enabled: boolean) => ({
  queryKey: linearProjectsKey,
  enabled,
  staleTime: 5 * 60 * 1000,
  queryFn: async ({ signal }: QueryContext): Promise<LinearProjectsResponse> => readJson<LinearProjectsResponse>(linearProjectsRoute, { signal }),
})

// Active issues for a repo's selected Linear projects (the Linear source browse). Refetch on mount
// so it self-heals; the server reads live from Linear.
export const linearProjectIssuesOptions = (projectIds: string[], enabled: boolean) => ({
  queryKey: linearProjectIssuesKey(projectIds),
  enabled,
  refetchOnMount: 'always' as const,
  queryFn: async ({ signal }: QueryContext): Promise<LinearProjectIssuesResponse> =>
    readJson<LinearProjectIssuesResponse>(linearProjectIssuesRoute(projectIds), { signal }),
})

// Full ticket detail for the side panel. refetchOnMount:'always' + staleTime 0 → opening the panel
// re-fetches (the route's ?refresh=1 forces a fresh Linear read and updates the cache).
export const linearIssueOptions = (identifier: string, enabled: boolean) => ({
  queryKey: linearIssueKey(identifier),
  enabled,
  staleTime: 0,
  refetchOnMount: 'always' as const,
  queryFn: async ({ signal }: QueryContext): Promise<LinearIssueDetail> => readJson<LinearIssueDetail>(linearIssueRoute(identifier), { signal }),
})
