// GitHub's TanStack Query definitions. They live with the plugin that owns the routes and the keys
// (../shared/api.ts) rather than in client-core, so the shell no longer carries a feature's read
// layer.
import { readJson, writeJson } from '@acorn/plugin-api/client'
import type { DiffDocumentTopology, DiffSearchPage, DiffSearchRequest, DiffSegmentPayload, DiffSegmentRequest } from '@acorn/plugin-api/ui/diff'
import {
  branchesKey,
  branchesRoute,
  closedPullsKey,
  closedPullsRoute,
  compareKey,
  compareRoute,
  diffSearchRoute,
  diffSegmentsRoute,
  conflictsKey,
  conflictsRoute,
  fileBlobKey,
  fileBlobRoute,
  fileSummariesKey,
  fileSummariesRoute,
  jobLogKey,
  jobLogRoute,
  mentionsKey,
  mentionsRoute,
  pinsKey,
  pinsRoute,
  pullDiffKey,
  pullDiffRoute,
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
  taskPullsKey,
  taskPullsRoute,
  type Branch,
  type ClosedPullsPage,
  type Compare,
  type DiffSearchBody,
  type DiffSegmentsBody,
  type FileBlob,
  type JobLog,
  type Label,
  type Pull,
  type PullConflicts,
  type PullDetail,
  type PullDiffResponse,
  type PullFilesResponse,
  type Repo,
  type RunJobs,
  type TaskPullRelationsResponse,
} from '../shared/api'

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

export const taskPullsOptions = (taskId: string, enabled: boolean) => ({
  queryKey: taskPullsKey(taskId),
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<TaskPullRelationsResponse> =>
    readJson<TaskPullRelationsResponse>(taskPullsRoute(taskId), { signal }),
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

// The pull and its files from GitHub again. The files come back as the diff's document, which is
// the only whole-file read left; the file list's summaries refetch from the refreshed mirror.
export const forceRefreshPull = async (
  owner: string,
  repo: string,
  number: string,
): Promise<{ detail: PullDetail; diff: PullDiffResponse }> => {
  const [detail, diff] = await Promise.all([
    readJson<PullDetail>(`${pullRoute(owner, repo, number)}?force=true`),
    readJson<PullDiffResponse>(`${pullDiffRoute(owner, repo, number)}?force=true`),
  ])
  return { detail, diff }
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

// The pull's files as the diff viewer's document: descriptors only, no patch text.
export const pullDiffOptions = (owner: string, repo: string, number: string, enabled: boolean) => ({
  queryKey: pullDiffKey(owner, repo, number),
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<PullDiffResponse> => readJson<PullDiffResponse>(pullDiffRoute(owner, repo, number), { signal }),
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
  queryFn: async ({ signal }: QueryContext): Promise<PullFilesResponse> => readJson<PullFilesResponse>(fileSummariesRoute(owner, repo, number), { signal }),
})

// A batch of a document's segments, by patch digest. The same route serves a pull's diff and a
// compare preview's.
export const fetchDiffSegments = (owner: string, repo: string, requests: DiffSegmentRequest[], signal?: AbortSignal): Promise<DiffSegmentPayload[]> =>
  writeJson<DiffSegmentPayload[]>(
    diffSegmentsRoute(owner, repo),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requests } satisfies DiffSegmentsBody),
      signal,
    },
    'diff_segments_failed',
  )

// One page of find matches over a document's files. The files ride along because a compare preview
// has no mirror on the node to look them up in.
export const searchDiff = (owner: string, repo: string, document: DiffDocumentTopology, request: DiffSearchRequest, signal?: AbortSignal): Promise<DiffSearchPage> =>
  writeJson<DiffSearchPage>(
    diffSearchRoute(owner, repo),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...request,
        files: document.files.flatMap((file) => (file.patchKey ? [{ path: file.path, patchKey: file.patchKey }] : [])),
      } satisfies DiffSearchBody),
      signal,
    },
    'diff_search_failed',
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

// Full head-blob body, fetched on demand (queryClient.fetchQuery) when a gap is expanded. The sha is
// immutable so the body never goes stale: fetch once per file, reuse for every gap.
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
