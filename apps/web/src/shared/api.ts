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

const repoBase = (owner: string, repo: string) => `/api/repos/${owner}/${repo}`
const pullBase = (owner: string, repo: string, number: string | number) => `${repoBase(owner, repo)}/pulls/${number}`

export const apiRoutes = {
  me: '/api/me',
  repos: '/api/repos',
  reposRefresh: '/api/repos/refresh',
  pulls: (owner: string, repo: string, state: 'open' | 'closed') => `${repoBase(owner, repo)}/pulls?state=${state}`,
  pull: pullBase,
  files: (owner: string, repo: string, number: string | number) => `${pullBase(owner, repo, number)}/files`,
  merge: (owner: string, repo: string, number: string | number) => `${pullBase(owner, repo, number)}/merge`,
  close: (owner: string, repo: string, number: string | number) => `${pullBase(owner, repo, number)}/close`,
  reopen: (owner: string, repo: string, number: string | number) => `${pullBase(owner, repo, number)}/reopen`,
  draft: (owner: string, repo: string, number: string | number) => `${pullBase(owner, repo, number)}/draft`,
  comments: (owner: string, repo: string, number: string | number) => `${pullBase(owner, repo, number)}/comments`,
  labels: (owner: string, repo: string, number: string | number) => `${pullBase(owner, repo, number)}/labels`,
  viewed: (owner: string, repo: string, number: string | number) => `${pullBase(owner, repo, number)}/viewed`,
  reviewComments: (owner: string, repo: string, number: string | number) => `${pullBase(owner, repo, number)}/review-comments`,
  reviewReply: (owner: string, repo: string, number: string | number, commentDatabaseId: number) =>
    `${pullBase(owner, repo, number)}/review-comments/${commentDatabaseId}/replies`,
  resolveThread: (owner: string, repo: string, number: string | number, threadId: string) =>
    `${pullBase(owner, repo, number)}/threads/${encodeURIComponent(threadId)}/resolve`,
  rerunFailed: (owner: string, repo: string, runId: number) => `${repoBase(owner, repo)}/actions/${runId}/rerun`,
  pins: '/api/pins',
  prefs: '/api/prefs',
} as const

export const queryKeys = {
  me: ['me'] as const,
  repos: ['repos'] as const,
  pulls: (owner: string, repo: string, state: 'open' | 'closed') => ['pulls', owner, repo, state] as const,
  pullsPrefix: (owner: string, repo: string) => ['pulls', owner, repo] as const,
  pull: (owner: string, repo: string, number: string) => ['pull', owner, repo, number] as const,
  pullPrefix: (owner: string, repo: string) => ['pull', owner, repo] as const,
  files: (owner: string, repo: string, number: string) => ['files', owner, repo, number] as const,
  pins: ['pins'] as const,
  prefs: ['prefs'] as const,
}
