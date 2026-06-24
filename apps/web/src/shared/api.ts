export type Me = { login: string; name: string; avatar: string; scopes: string[] }
export type Repo = {
  id: number
  owner: string
  name: string
  private: boolean
  defaultBranch: string | null
  pushedAt: number | null
}
export type Pull = {
  number: number
  title: string
  state: string
  draft: boolean
  author: string | null
  headRef: string | null
  baseRef: string | null
  updatedAt: number | null
}

// Closed PRs are paginated on demand (one GitHub page per fetch); nextPage is null at the end.
export type ClosedPullsPage = { pulls: Pull[]; nextPage: number | null }

export type PullFile = {
  path: string
  status: string | null
  additions: number | null
  deletions: number | null
  sha: string | null
  viewed: boolean
  patch: string | null
}
export type Review = { id: string; author: string | null; state: string | null; body: string | null; submittedAt: number | null }
export type Comment = { id: string; author: string | null; body: string | null; createdAt: number | null }
export type Check = { name: string; status: string | null; url: string | null; runId: number | null }
export type Label = { name: string; color: string | null }
export type ThreadComment = { id: string; databaseId: number | null; author: string | null; body: string | null; createdAt: number | null }
export type Thread = {
  threadId: string
  path: string | null
  line: number | null
  side: string | null
  resolved: boolean
  comments: ThreadComment[]
}
export type PullDetail = {
  pull: (Pull & { number: number; body: string | null; headSha: string | null }) | null
  labels: Label[]
  reviews: Review[]
  comments: Comment[]
  checks: Check[]
  threads: Thread[]
}
// One PR's full warmed payload, returned by the batch prefetch endpoint.
export type PullBatchItem = { number: number; detail: PullDetail; files: PullFile[] }

export const repoRoute = (owner: string, repo: string, child = '') => `/api/repos/${owner}/${repo}${child ? `/${child}` : ''}`
export const pullRoute = (owner: string, repo: string, number: string | number, child = '') =>
  repoRoute(owner, repo, `pulls/${number}${child ? `/${child}` : ''}`)

export const meRoute = '/api/me'
export const reposRoute = '/api/repos'
export const reposRefreshRoute = '/api/repos/refresh'
export const pullsRoute = (owner: string, repo: string, state: 'open' | 'closed') => `${repoRoute(owner, repo)}/pulls?state=${state}`
export const closedPullsRoute = (owner: string, repo: string, page: number) => `${pullsRoute(owner, repo, 'closed')}&page=${page}`
export const pullsBatchRoute = (owner: string, repo: string) => `${repoRoute(owner, repo)}/pulls/batch`
export const resolveThreadRoute = (owner: string, repo: string, number: string | number, threadId: string) =>
  pullRoute(owner, repo, number, `threads/${encodeURIComponent(threadId)}/resolve`)
export const rerunFailedRoute = (owner: string, repo: string, runId: number) => repoRoute(owner, repo, `actions/${runId}/rerun`)
export const pinsRoute = '/api/pins'
export const prefsRoute = '/api/prefs'

export const meKey = ['me'] as const
export const reposKey = ['repos'] as const
export const pullsKey = (owner: string, repo: string, state: 'open' | 'closed') => ['pulls', owner, repo, state] as const
// Distinct from pullsKey(_, 'closed'): the closed list is now an infinite query ({pages}), so it must
// not share a key with the old finite-array cache entry (a persisted array would poison .data.pages).
export const closedPullsKey = (owner: string, repo: string) => ['pulls', owner, repo, 'closed', 'pages'] as const
export const pullsPrefixKey = (owner: string, repo: string) => ['pulls', owner, repo] as const
export const pullKey = (owner: string, repo: string, number: string) => ['pull', owner, repo, number] as const
export const pullPrefixKey = (owner: string, repo: string) => ['pull', owner, repo] as const
export const filesKey = (owner: string, repo: string, number: string) => ['files', owner, repo, number] as const
export const pinsKey = ['pins'] as const
export const prefsKey = ['prefs'] as const
