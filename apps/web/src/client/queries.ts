// Shared TanStack Query definitions. Two consumers each (dropdown + PR list both read repos),
// so the options live here to avoid drift. All reads are same-origin cookie-auth; 401 on /me
// is a valid logged-out state, elsewhere it's an error.

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

export const meOptions = () => ({
  queryKey: ['me'] as const,
  queryFn: async (): Promise<Me | null> => {
    const res = await fetch('/api/me')
    if (res.status === 401) return null
    if (!res.ok) throw new Error(`/api/me ${res.status}`)
    return res.json()
  },
})

export const reposOptions = (enabled: boolean) => ({
  queryKey: ['repos'] as const,
  enabled,
  queryFn: async (): Promise<Repo[]> => {
    const res = await fetch('/api/repos')
    if (!res.ok) throw new Error(`/api/repos ${res.status}`)
    return res.json()
  },
})

export const pullsOptions = (owner: string, repo: string, state: 'open' | 'closed', enabled: boolean) => ({
  queryKey: ['pulls', owner, repo, state] as const,
  enabled,
  queryFn: async (): Promise<Pull[]> => {
    const res = await fetch(`/api/repos/${owner}/${repo}/pulls?state=${state}`)
    if (!res.ok) throw new Error(`/api/repos/${owner}/${repo}/pulls ${res.status}`)
    return res.json()
  },
})

export type PullFile = {
  path: string
  status: string | null
  additions: number | null
  deletions: number | null
  sha: string | null
  viewed: boolean
  patch: string | null // null for binary / too-large files
}
export type Review = { id: string; author: string | null; state: string | null; body: string | null; submittedAt: number | null }
export type Comment = { id: string; author: string | null; body: string | null; createdAt: number | null }
export type Check = { name: string; status: string | null; url: string | null }
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

export const pullDetailOptions = (owner: string, repo: string, number: string, enabled: boolean) => ({
  queryKey: ['pull', owner, repo, number] as const,
  enabled,
  queryFn: async (): Promise<PullDetail> => {
    const res = await fetch(`/api/repos/${owner}/${repo}/pulls/${number}`)
    if (!res.ok) throw new Error(`/api/repos/${owner}/${repo}/pulls/${number} ${res.status}`)
    return res.json()
  },
})

export const pinsOptions = (enabled: boolean) => ({
  queryKey: ['pins'] as const,
  enabled,
  queryFn: async (): Promise<number[]> => {
    const res = await fetch('/api/pins')
    if (!res.ok) throw new Error(`/api/pins ${res.status}`)
    return res.json()
  },
})

export const prefsOptions = (enabled: boolean) => ({
  queryKey: ['prefs'] as const,
  enabled,
  queryFn: async (): Promise<Record<string, string>> => {
    const res = await fetch('/api/prefs')
    if (!res.ok) throw new Error(`/api/prefs ${res.status}`)
    return res.json()
  },
})

export const filesOptions = (owner: string, repo: string, number: string, enabled: boolean) => ({
  queryKey: ['files', owner, repo, number] as const,
  enabled,
  queryFn: async (): Promise<PullFile[]> => {
    const res = await fetch(`/api/repos/${owner}/${repo}/pulls/${number}/files`)
    if (!res.ok) throw new Error(`/api/repos/${owner}/${repo}/pulls/${number}/files ${res.status}`)
    return res.json()
  },
})
