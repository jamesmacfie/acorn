// GitHub's TanStack Query definitions. They live with the plugin that owns the routes and the keys
// (../contract/api.ts) rather than in client-core, so the shell no longer carries a feature's read
// layer. Moved verbatim from @acorn/client-core/queries.ts — same keys, same staleTime, same refetch
// and invalidation behaviour.
import { readJson, writeJson } from '@acorn/plugin-api/client'
import {
  branchesKey,
  branchesRoute,
  closedPullsKey,
  closedPullsRoute,
  compareKey,
  compareRoute,
  conflictsKey,
  conflictsRoute,
  fileBlobKey,
  fileBlobRoute,
  filePatchKey,
  filePatchRoute,
  filePatchesRoute,
  fileSummariesKey,
  fileSummariesRoute,
  filesKey,
  jobLogKey,
  jobLogRoute,
  mentionsKey,
  mentionsRoute,
  pinsKey,
  pinsRoute,
  pullKey,
  pullRoute,
  pullsKey,
  pullsRoute,
  repoLabelsKey,
  repoLabelsRoute,
  reposKey,
  reposRoute,
  runJobsKey,
  runJobsRoute,
  type Branch,
  type ClosedPullsPage,
  type Compare,
  type FileBlob,
  type JobLog,
  type Label,
  type Pull,
  type PullConflicts,
  type PullDetail,
  type PullFile,
  type PullFilesPatchRequest,
  type Repo,
  type RunJobs,
} from '../contract/api'

type QueryContext = { signal?: AbortSignal }
type PageQueryContext = QueryContext & { pageParam: number }

export const reposOptions = (enabled: boolean) => ({
  queryKey: reposKey,
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<Repo[]> => readJson<Repo[]>(reposRoute, { signal }),
})

export const pullsOptions = (owner: string, repo: string, state: 'open' | 'closed', enabled: boolean) => ({
  queryKey: pullsKey(owner, repo, state),
  enabled,
  refetchInterval: 60_000,
  refetchIntervalInBackground: false,
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

export const forceRefreshPull = async (
  owner: string,
  repo: string,
  number: string,
): Promise<{ detail: PullDetail; files: PullFile[] }> => {
  const [detail, files] = await Promise.all([
    readJson<PullDetail>(`${pullRoute(owner, repo, number)}?force=true`),
    readJson<PullFile[]>(`${pullRoute(owner, repo, number, 'files')}?force=true`),
  ])
  return { detail, files }
}

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

export const filesOptions = (owner: string, repo: string, number: string, enabled: boolean) => ({
  queryKey: filesKey(owner, repo, number),
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<PullFile[]> => readJson<PullFile[]>(pullRoute(owner, repo, number, 'files'), { signal }),
})

export const pullConflictsOptions = (owner: string, repo: string, number: string, base: string, enabled: boolean) => ({
  queryKey: conflictsKey(owner, repo, number, base),
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<PullConflicts> =>
    readJson<PullConflicts>(conflictsRoute(owner, repo, number, base), { signal }),
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

export const jobLogOptions = (owner: string, repo: string, jobId: number, enabled: boolean) => ({
  queryKey: jobLogKey(owner, repo, jobId),
  enabled,
  staleTime: Infinity,
  queryFn: async ({ signal }: QueryContext): Promise<JobLog> => readJson<JobLog>(jobLogRoute(owner, repo, jobId), { signal }),
})
