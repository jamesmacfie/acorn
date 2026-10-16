// GitLab's TanStack Query definitions, beside the routes and keys they address.
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
  jobLogKey,
  jobLogRoute,
  labelsKey,
  labelsRoute,
  membersKey,
  membersRoute,
  mergeRequestKey,
  mergeRequestRoute,
  mergeRequestsKey,
  mergeRequestsRoute,
  projectsKey,
  projectsRoute,
  type DiffSearchBody,
  type DiffSegmentsBody,
  type FileText,
  type GitlabProject,
  type JobLog,
  type Member,
  type MergeRequestDetail,
  type MergeRequestDiff,
  type MergeRequestFiles,
  type MergeRequestRow,
  type ProjectLabel,
} from '../shared/api'

type QueryContext = { signal?: AbortSignal }

export const projectsOptions = (enabled: boolean) => ({
  queryKey: projectsKey,
  enabled,
  queryFn: ({ signal }: QueryContext) => readJson<GitlabProject[]>(projectsRoute, { signal }),
})

export const mergeRequestsOptions = (path: string, state: 'open' | 'closed', enabled: boolean) => ({
  queryKey: mergeRequestsKey(path, state),
  enabled,
  refetchInterval: 60_000,
  refetchIntervalInBackground: false,
  queryFn: ({ signal }: QueryContext) => readJson<MergeRequestRow[]>(mergeRequestsRoute(path, state), { signal }),
})

export const mergeRequestOptions = (path: string, number: string, enabled: boolean) => ({
  queryKey: mergeRequestKey(path, number),
  enabled,
  queryFn: ({ signal }: QueryContext) => readJson<MergeRequestDetail>(mergeRequestRoute(path, number), { signal }),
})

export const filesOptions = (path: string, number: string, enabled: boolean) => ({
  queryKey: filesKey(path, number),
  enabled,
  queryFn: ({ signal }: QueryContext) => readJson<MergeRequestFiles>(filesRoute(path, number), { signal }),
})

export const diffOptions = (path: string, number: string, enabled: boolean) => ({
  queryKey: diffKey(path, number),
  enabled,
  queryFn: ({ signal }: QueryContext) => readJson<MergeRequestDiff>(diffRoute(path, number), { signal }),
})

/** The merge request and its files again from GitLab, past the mirror's window. */
export const forceRefresh = (path: string, number: string) =>
  Promise.all([
    readJson<MergeRequestDetail>(`${mergeRequestRoute(path, number)}?force=true`),
    readJson<MergeRequestDiff>(`${diffRoute(path, number)}?force=true`),
  ])

export const labelsOptions = (path: string, enabled: boolean) => ({
  queryKey: labelsKey(path),
  enabled,
  staleTime: 5 * 60_000,
  queryFn: ({ signal }: QueryContext) => readJson<ProjectLabel[]>(labelsRoute(path), { signal }),
})

export const membersOptions = (path: string, enabled: boolean) => ({
  queryKey: membersKey(path),
  enabled,
  staleTime: 5 * 60_000,
  queryFn: ({ signal }: QueryContext) => readJson<Member[]>(membersRoute(path), { signal }),
})

// A whole job log, kept in memory only and for a few minutes after the panel closes.
export const jobLogOptions = (path: string, jobId: number, enabled: boolean) => ({
  queryKey: jobLogKey(path, jobId),
  enabled,
  staleTime: 15_000,
  gcTime: 5 * 60_000,
  meta: { persist: false },
  queryFn: ({ signal }: QueryContext) => readJson<JobLog>(jobLogRoute(path, jobId), { signal }),
})

// A file at a commit never changes, so one read serves every gap in it.
export const fileTextOptions = (path: string, commit: string, file: string) => ({
  queryKey: fileTextKey(path, commit, file),
  staleTime: Infinity,
  queryFn: ({ signal }: QueryContext) => readJson<FileText>(fileTextRoute(path, commit, file), { signal }),
})

export const fetchDiffSegments = (path: string, requests: DiffSegmentRequest[], signal?: AbortSignal) =>
  writeJson<DiffSegmentPayload[]>(
    diffSegmentsRoute(path),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requests } satisfies DiffSegmentsBody),
      signal,
    },
    'diff_segments_failed',
  )

export const searchDiff = (
  path: string,
  document: DiffDocumentTopology,
  request: DiffSearchRequest,
  signal?: AbortSignal,
) =>
  writeJson<DiffSearchPage>(
    diffSearchRoute(path),
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
