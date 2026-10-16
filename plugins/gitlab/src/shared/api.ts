// GitLab's wire contract: what its routes answer, the /v1/p/gitlab route builders, and the TanStack
// query keys that address them. Both halves of this plugin read it.
//
// A merge request's detail answers the shared review views' neutral model directly
// (docs/plugins/change-request-ui.md), so the client maps nothing. A project is addressed by its
// server's host, then its full path URL-encoded into one segment, which GitLab's own API also takes.
import type { DiffDocumentTopology, DiffSearchRequest, DiffSegmentRequest } from '@acorn/diff-document/document'
import type { ChangedFile, ChangeRequestDetail, ChangeRequestSummary, Label } from '@acorn/change-request-ui/model'
import { splitAddress } from './mergeRequestRef'

export type GitlabProject = {
  id: number
  /** The server it's on, such as `gitlab.com`. */
  host: string
  /** The full path in GitLab's spelling, such as `group/sub/api`. */
  path: string
  name: string
  private: boolean
  defaultBranch: string | null
  lastActivityAt: number | null
}

export type GitlabImportItem =
  | { host: string; projectId: number; action: 'map'; path: string }
  | { host: string; projectId: number; action: 'clone'; parentDir: string }
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

/** A server this Node has a connection to, and the connection that serves it. */
export type GitlabServerSummary = { host: string; connectionId: string }
export const serversRoute = '/v1/p/gitlab/servers'

export const projectsRoute = '/v1/p/gitlab/projects'
export const importRoute = '/v1/p/gitlab/import'
const projectRoute = (address: string, child = '') => {
  const { host, path } = splitAddress(address)
  return `${projectsRoute}/${host}/${encodeURIComponent(path)}${child ? `/${child}` : ''}`
}
export const mergeRequestsRoute = (address: string, state: 'open' | 'closed') =>
  projectRoute(address, `merge-requests?state=${state}`)
export const mergeRequestRoute = (address: string, number: string | number, child = '') =>
  projectRoute(address, `merge-requests/${number}${child ? `/${child}` : ''}`)
export const filesRoute = (address: string, number: string | number) => mergeRequestRoute(address, number, 'files')
export const diffRoute = (address: string, number: string | number) => mergeRequestRoute(address, number, 'diff')
export const diffSegmentsRoute = (address: string) => projectRoute(address, 'diff/segments')
export const diffSearchRoute = (address: string) => projectRoute(address, 'diff/search')
/** A file's whole text at a commit, for expanding the context around a hunk. */
export const fileTextRoute = (address: string, commit: string, file: string) =>
  projectRoute(address, `files/${commit}?path=${encodeURIComponent(file)}`)
export const labelsRoute = (address: string) => projectRoute(address, 'labels')
export const membersRoute = (address: string) => projectRoute(address, 'members')
export const jobLogRoute = (address: string, jobId: number) => projectRoute(address, `jobs/${jobId}/log`)
export const jobRetryRoute = (address: string, jobId: number) => projectRoute(address, `jobs/${jobId}/retry`)

export const projectsKey = ['gitlab-projects'] as const
export const mergeRequestsKey = (address: string, state: 'open' | 'closed') => ['gitlab-mrs', address, state] as const
export const mergeRequestsPrefixKey = (address: string) => ['gitlab-mrs', address] as const
export const mergeRequestKey = (address: string, number: string) => ['gitlab-mr', address, number] as const
export const mergeRequestPrefixKey = (address: string) => ['gitlab-mr', address] as const
export const filesKey = (address: string, number: string) => ['gitlab-mr-files', address, number] as const
// Not persisted: a document can be large, and the node rebuilds it from its own blobs in one read.
export const diffKey = (address: string, number: string) => ['gitlab-mr-files', address, number, 'diff'] as const
export const fileTextKey = (address: string, commit: string, file: string) =>
  ['gitlab-file', address, commit, file] as const
export const labelsKey = (address: string) => ['gitlab-labels', address] as const
export const membersKey = (address: string) => ['gitlab-members', address] as const
export const jobLogKey = (address: string, jobId: number) => ['gitlab-job-log', address, jobId] as const
