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

export const mergeRequestsOptions = (address: string, state: 'open' | 'closed', enabled: boolean) => ({
  queryKey: mergeRequestsKey(address, state),
  enabled,
  refetchInterval: 60_000,
  refetchIntervalInBackground: false,
  queryFn: ({ signal }: QueryContext) => readJson<MergeRequestRow[]>(mergeRequestsRoute(address, state), { signal }),
})

export const mergeRequestOptions = (address: string, number: string, enabled: boolean) => ({
  queryKey: mergeRequestKey(address, number),
  enabled,
  queryFn: ({ signal }: QueryContext) => readJson<MergeRequestDetail>(mergeRequestRoute(address, number), { signal }),
})

export const filesOptions = (address: string, number: string, enabled: boolean) => ({
  queryKey: filesKey(address, number),
  enabled,
  queryFn: ({ signal }: QueryContext) => readJson<MergeRequestFiles>(filesRoute(address, number), { signal }),
})

export const diffOptions = (address: string, number: string, enabled: boolean) => ({
  queryKey: diffKey(address, number),
  enabled,
  queryFn: ({ signal }: QueryContext) => readJson<MergeRequestDiff>(diffRoute(address, number), { signal }),
})

/** The merge request and its files again from GitLab, past the mirror's window. */
export const forceRefresh = (address: string, number: string) =>
  Promise.all([
    readJson<MergeRequestDetail>(`${mergeRequestRoute(address, number)}?force=true`),
    readJson<MergeRequestDiff>(`${diffRoute(address, number)}?force=true`),
  ])

export const labelsOptions = (address: string, enabled: boolean) => ({
  queryKey: labelsKey(address),
  enabled,
  staleTime: 5 * 60_000,
  queryFn: ({ signal }: QueryContext) => readJson<ProjectLabel[]>(labelsRoute(address), { signal }),
})

export const membersOptions = (address: string, enabled: boolean) => ({
  queryKey: membersKey(address),
  enabled,
  staleTime: 5 * 60_000,
  queryFn: ({ signal }: QueryContext) => readJson<Member[]>(membersRoute(address), { signal }),
})

// A whole job log, kept in memory only and for a few minutes after the panel closes.
export const jobLogOptions = (address: string, jobId: number, enabled: boolean) => ({
  queryKey: jobLogKey(address, jobId),
  enabled,
  staleTime: 15_000,
  gcTime: 5 * 60_000,
  meta: { persist: false },
  queryFn: ({ signal }: QueryContext) => readJson<JobLog>(jobLogRoute(address, jobId), { signal }),
})

// A file at a commit never changes, so one read serves every gap in it.
export const fileTextOptions = (address: string, commit: string, file: string) => ({
  queryKey: fileTextKey(address, commit, file),
  staleTime: Infinity,
  queryFn: ({ signal }: QueryContext) => readJson<FileText>(fileTextRoute(address, commit, file), { signal }),
})

export const fetchDiffSegments = (address: string, requests: DiffSegmentRequest[], signal?: AbortSignal) =>
  writeJson<DiffSegmentPayload[]>(
    diffSegmentsRoute(address),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requests } satisfies DiffSegmentsBody),
      signal,
    },
    'diff_segments_failed',
  )

export const searchDiff = (
  address: string,
  document: DiffDocumentTopology,
  request: DiffSearchRequest,
  signal?: AbortSignal,
) =>
  writeJson<DiffSearchPage>(
    diffSearchRoute(address),
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
