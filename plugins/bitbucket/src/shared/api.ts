// Bitbucket's wire contract: what its routes answer, the /v1/p/bitbucket route builders, and the
// TanStack query keys that address them. Both halves of this plugin read it.
//
// A pull request's detail answers the shared review views' neutral model directly
// (docs/plugins/change-request-ui.md), so the client maps nothing. A repository is addressed by its
// full name, `workspace/repo`, which is two URL-safe segments.
import type { DiffDocumentTopology, DiffSearchRequest, DiffSegmentRequest } from '@acorn/diff-document/document'
import type { ChangedFile, ChangeRequestDetail, ChangeRequestSummary } from '@acorn/change-request-ui/model'

export type BitbucketRepository = {
  /** The full name as Bitbucket spells it, such as `acme/api`. */
  path: string
  name: string
  private: boolean
  defaultBranch: string | null
  updatedAt: number | null
}

export type BitbucketImportItem =
  | { repository: string; action: 'map'; path: string }
  | { repository: string; action: 'clone'; parentDir: string }
export type BitbucketImportResult = {
  repository: string
  action: 'map' | 'clone'
  ok: boolean
  /** The acorn project it became. */
  acornProjectId?: string
  error?: string
}

/** One pull request row. `sourceRepository` is a fork's full name, lowercased, or null. */
export type PullRequestRow = ChangeRequestSummary & { authorAvatar: string | null; sourceRepository: string | null }

/** A list, and when the mirror last read it from Bitbucket. The open list refreshes on a clock, and a
 *  refresh that fails, such as on the rate limit, leaves an older copy that the list says is old. */
export type PullRequestList = { rows: PullRequestRow[]; fetchedAt: number }

export type PullRequestDetail = ChangeRequestDetail & {
  /** Every person's picture this detail names, by nickname. */
  avatars: Record<string, string>
  sourceRepository: string | null
}

// `warning` says Bitbucket may hold more files than the mirror's page budget read.
export type PullRequestFiles = { files: ChangedFile[]; warning: string | null }
export type PullRequestDiff = { document: DiffDocumentTopology; revision: string | null; warning: string | null }
export type DiffSegmentsBody = { requests: DiffSegmentRequest[] }
export type DiffSearchBody = DiffSearchRequest & { files: { path: string; patchKey: string }[] }

export type FileText = { text: string }
export type Member = { login: string; avatarUrl: string | null }

export const repositoriesRoute = '/v1/p/bitbucket/repositories'
export const importRoute = '/v1/p/bitbucket/import'
const repositoryRoute = (repository: string, child = '') =>
  `${repositoriesRoute}/${repository}${child ? `/${child}` : ''}`
export const pullRequestsRoute = (repository: string, state: 'open' | 'closed') =>
  repositoryRoute(repository, `pull-requests?state=${state}`)
export const pullRequestRoute = (repository: string, number: string | number, child = '') =>
  repositoryRoute(repository, `pull-requests/${number}${child ? `/${child}` : ''}`)
export const filesRoute = (repository: string, number: string | number) => pullRequestRoute(repository, number, 'files')
export const diffRoute = (repository: string, number: string | number) => pullRequestRoute(repository, number, 'diff')
export const diffSegmentsRoute = (repository: string) => repositoryRoute(repository, 'diff/segments')
export const diffSearchRoute = (repository: string) => repositoryRoute(repository, 'diff/search')
/** A file's whole text at a commit, for expanding the context around a hunk. */
export const fileTextRoute = (repository: string, commit: string, file: string) =>
  repositoryRoute(repository, `files/${commit}?path=${encodeURIComponent(file)}`)
export const membersRoute = (repository: string) => repositoryRoute(repository, 'members')

export const repositoriesKey = ['bitbucket-repositories'] as const
export const pullRequestsKey = (repository: string, state: 'open' | 'closed') =>
  ['bitbucket-prs', repository, state] as const
export const pullRequestsPrefixKey = (repository: string) => ['bitbucket-prs', repository] as const
export const pullRequestKey = (repository: string, number: string) => ['bitbucket-pr', repository, number] as const
export const pullRequestPrefixKey = (repository: string) => ['bitbucket-pr', repository] as const
export const filesKey = (repository: string, number: string) => ['bitbucket-pr-files', repository, number] as const
// Not persisted: a document can be large, and the node rebuilds it from its own blobs in one read.
export const diffKey = (repository: string, number: string) =>
  ['bitbucket-pr-files', repository, number, 'diff'] as const
export const fileTextKey = (repository: string, commit: string, file: string) =>
  ['bitbucket-file', repository, commit, file] as const
export const membersKey = (repository: string) => ['bitbucket-members', repository] as const
