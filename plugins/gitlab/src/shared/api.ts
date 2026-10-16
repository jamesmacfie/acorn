// GitLab's wire contract: what its routes answer, the /v1/p/gitlab route builders, and the TanStack
// query keys that address them. Both halves of this plugin read it.
//
// A merge request's detail answers the shared review views' neutral model directly
// (docs/plugins/change-request-ui.md), so the client maps nothing. A project is addressed by its full
// path, URL-encoded into one segment, which GitLab's own API also takes.
import type { DiffDocumentTopology, DiffSearchRequest, DiffSegmentRequest } from '@acorn/diff-document/document'
import type { ChangedFile, ChangeRequestDetail, ChangeRequestSummary, Label } from '@acorn/change-request-ui/model'

export type GitlabProject = {
  id: number
  /** The full path in GitLab's spelling, such as `group/sub/api`. */
  path: string
  name: string
  private: boolean
  defaultBranch: string | null
  lastActivityAt: number | null
}

export type GitlabImportItem =
  | { projectId: number; action: 'map'; path: string }
  | { projectId: number; action: 'clone'; parentDir: string }
export type GitlabImportResult = {
  projectId: number
  path: string
  action: 'map' | 'clone'
  ok: boolean
  /** The acorn project it became. */
  acornProjectId?: string
  error?: string
}

/** One merge request row. `pipelineStatus` is the head pipeline's, in the checks vocabulary. */
export type MergeRequestRow = ChangeRequestSummary & { authorAvatar: string | null; pipelineStatus: string | null }

export type MergeRequestDetail = ChangeRequestDetail & {
  /** Every person's picture this detail names, by username. */
  avatars: Record<string, string>
}

// `warning` says GitLab may hold more files than the mirror's page budget read.
export type MergeRequestFiles = { files: ChangedFile[]; warning: string | null }
export type MergeRequestDiff = { document: DiffDocumentTopology; revision: string | null; warning: string | null }
export type DiffSegmentsBody = { requests: DiffSegmentRequest[] }
export type DiffSearchBody = DiffSearchRequest & { files: { path: string; patchKey: string }[] }

export type FileText = { text: string }
/** A job's log, whole. GitLab sends it as one text with its section markers. */
export type JobLog = { text: string }
export type ProjectLabel = Label
export type Member = { login: string; avatarUrl: string | null }

export const projectsRoute = '/v1/p/gitlab/projects'
export const importRoute = '/v1/p/gitlab/import'
const projectRoute = (path: string, child = '') =>
  `${projectsRoute}/${encodeURIComponent(path)}${child ? `/${child}` : ''}`
export const mergeRequestsRoute = (path: string, state: 'open' | 'closed') =>
  projectRoute(path, `merge-requests?state=${state}`)
export const mergeRequestRoute = (path: string, number: string | number, child = '') =>
  projectRoute(path, `merge-requests/${number}${child ? `/${child}` : ''}`)
export const filesRoute = (path: string, number: string | number) => mergeRequestRoute(path, number, 'files')
export const diffRoute = (path: string, number: string | number) => mergeRequestRoute(path, number, 'diff')
export const diffSegmentsRoute = (path: string) => projectRoute(path, 'diff/segments')
export const diffSearchRoute = (path: string) => projectRoute(path, 'diff/search')
/** A file's whole text at a commit, for expanding the context around a hunk. */
export const fileTextRoute = (path: string, commit: string, file: string) =>
  projectRoute(path, `files/${commit}?path=${encodeURIComponent(file)}`)
export const labelsRoute = (path: string) => projectRoute(path, 'labels')
export const membersRoute = (path: string) => projectRoute(path, 'members')
export const jobLogRoute = (path: string, jobId: number) => projectRoute(path, `jobs/${jobId}/log`)
export const jobRetryRoute = (path: string, jobId: number) => projectRoute(path, `jobs/${jobId}/retry`)

export const projectsKey = ['gitlab-projects'] as const
export const mergeRequestsKey = (path: string, state: 'open' | 'closed') => ['gitlab-mrs', path, state] as const
export const mergeRequestsPrefixKey = (path: string) => ['gitlab-mrs', path] as const
export const mergeRequestKey = (path: string, number: string) => ['gitlab-mr', path, number] as const
export const mergeRequestPrefixKey = (path: string) => ['gitlab-mr', path] as const
export const filesKey = (path: string, number: string) => ['gitlab-mr-files', path, number] as const
// Not persisted: a document can be large, and the node rebuilds it from its own blobs in one read.
export const diffKey = (path: string, number: string) => ['gitlab-mr-files', path, number, 'diff'] as const
export const fileTextKey = (path: string, commit: string, file: string) => ['gitlab-file', path, commit, file] as const
export const labelsKey = (path: string) => ['gitlab-labels', path] as const
export const membersKey = (path: string) => ['gitlab-members', path] as const
export const jobLogKey = (path: string, jobId: number) => ['gitlab-job-log', path, jobId] as const
