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

export const pullsOptions = (owner: string, repo: string, enabled: boolean) => ({
  queryKey: ['pulls', owner, repo] as const,
  enabled,
  queryFn: async (): Promise<Pull[]> => {
    const res = await fetch(`/api/repos/${owner}/${repo}/pulls`)
    if (!res.ok) throw new Error(`/api/repos/${owner}/${repo}/pulls ${res.status}`)
    return res.json()
  },
})
