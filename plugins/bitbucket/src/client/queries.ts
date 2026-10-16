// Bitbucket's TanStack Query definitions, beside the routes and keys they address.
import { readJson, writeJson } from '@acorn/plugin-api/client'
import type {
  DiffDocumentTopology,
  DiffSearchPage,
  DiffSearchRequest,
  DiffSegmentPayload,
  DiffSegmentRequest,
} from '@acorn/plugin-api/ui/diff'
import {
  diffKey,
  diffRoute,
  diffSearchRoute,
  diffSegmentsRoute,
  fileTextKey,
  fileTextRoute,
  filesKey,
  filesRoute,
  membersKey,
  membersRoute,
  pullRequestKey,
  pullRequestRoute,
  pullRequestsKey,
  pullRequestsRoute,
  repositoriesKey,
  repositoriesRoute,
  type BitbucketRepository,
  type DiffSearchBody,
  type DiffSegmentsBody,
  type FileText,
  type Member,
  type PullRequestDetail,
  type PullRequestDiff,
  type PullRequestFiles,
  type PullRequestList,
} from '../shared/api'

type QueryContext = { signal?: AbortSignal }

export const repositoriesOptions = (enabled: boolean) => ({
  queryKey: repositoriesKey,
  enabled,
  queryFn: ({ signal }: QueryContext) => readJson<BitbucketRepository[]>(repositoriesRoute, { signal }),
})

export const pullRequestsOptions = (repository: string, state: 'open' | 'closed', enabled: boolean) => ({
  queryKey: pullRequestsKey(repository, state),
  enabled,
  refetchInterval: 60_000,
  refetchIntervalInBackground: false,
  queryFn: ({ signal }: QueryContext) => readJson<PullRequestList>(pullRequestsRoute(repository, state), { signal }),
})

export const pullRequestOptions = (repository: string, number: string, enabled: boolean) => ({
  queryKey: pullRequestKey(repository, number),
  enabled,
  queryFn: ({ signal }: QueryContext) => readJson<PullRequestDetail>(pullRequestRoute(repository, number), { signal }),
})

export const filesOptions = (repository: string, number: string, enabled: boolean) => ({
  queryKey: filesKey(repository, number),
  enabled,
  queryFn: ({ signal }: QueryContext) => readJson<PullRequestFiles>(filesRoute(repository, number), { signal }),
})

export const diffOptions = (repository: string, number: string, enabled: boolean) => ({
  queryKey: diffKey(repository, number),
  enabled,
  queryFn: ({ signal }: QueryContext) => readJson<PullRequestDiff>(diffRoute(repository, number), { signal }),
})

/** The pull request and its files again from Bitbucket, past the mirror's window. */
export const forceRefresh = (repository: string, number: string) =>
  Promise.all([
    readJson<PullRequestDetail>(`${pullRequestRoute(repository, number)}?force=true`),
    readJson<PullRequestDiff>(`${diffRoute(repository, number)}?force=true`),
  ])

export const membersOptions = (repository: string, enabled: boolean) => ({
  queryKey: membersKey(repository),
  enabled,
  staleTime: 5 * 60_000,
  queryFn: ({ signal }: QueryContext) => readJson<Member[]>(membersRoute(repository), { signal }),
})

// A file at a commit never changes, so one read serves every gap in it.
export const fileTextOptions = (repository: string, commit: string, file: string) => ({
  queryKey: fileTextKey(repository, commit, file),
  staleTime: Infinity,
  queryFn: ({ signal }: QueryContext) => readJson<FileText>(fileTextRoute(repository, commit, file), { signal }),
})

export const fetchDiffSegments = (repository: string, requests: DiffSegmentRequest[], signal?: AbortSignal) =>
  writeJson<DiffSegmentPayload[]>(
    diffSegmentsRoute(repository),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requests } satisfies DiffSegmentsBody),
      signal,
    },
    'diff_segments_failed',
  )

export const searchDiff = (
  repository: string,
  document: DiffDocumentTopology,
  request: DiffSearchRequest,
  signal?: AbortSignal,
) =>
  writeJson<DiffSearchPage>(
    diffSearchRoute(repository),
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
