// Shared TanStack Query definitions. Two consumers each (dropdown + PR list both read repos),
// so the options live here to avoid drift. All reads are same-origin cookie-auth; 401 on /me
// is a valid logged-out state, elsewhere it's an error.
import { readJson } from './apiClient'
import { apiRoutes, queryKeys, type Me, type Pull, type PullDetail, type PullFile, type Repo } from '../shared/api'

export { apiRoutes, queryKeys }
export type { Check, Comment, Label, Me, Pull, PullDetail, PullFile, Repo, Review, Thread, ThreadComment } from '../shared/api'

export const meOptions = () => ({
  queryKey: queryKeys.me,
  queryFn: async (): Promise<Me | null> => readJson<Me | null>(apiRoutes.me, { nullOn401: true }),
})

export const reposOptions = (enabled: boolean) => ({
  queryKey: queryKeys.repos,
  enabled,
  queryFn: async (): Promise<Repo[]> => readJson<Repo[]>(apiRoutes.repos),
})

export const pullsOptions = (owner: string, repo: string, state: 'open' | 'closed', enabled: boolean) => ({
  queryKey: queryKeys.pulls(owner, repo, state),
  enabled,
  queryFn: async (): Promise<Pull[]> => readJson<Pull[]>(apiRoutes.pulls(owner, repo, state)),
})

export const pullDetailOptions = (owner: string, repo: string, number: string, enabled: boolean) => ({
  queryKey: queryKeys.pull(owner, repo, number),
  enabled,
  queryFn: async (): Promise<PullDetail> => readJson<PullDetail>(apiRoutes.pull(owner, repo, number)),
})

export const pinsOptions = (enabled: boolean) => ({
  queryKey: queryKeys.pins,
  enabled,
  queryFn: async (): Promise<number[]> => readJson<number[]>(apiRoutes.pins),
})

export const prefsOptions = (enabled: boolean) => ({
  queryKey: queryKeys.prefs,
  enabled,
  queryFn: async (): Promise<Record<string, string>> => readJson<Record<string, string>>(apiRoutes.prefs),
})

export const filesOptions = (owner: string, repo: string, number: string, enabled: boolean) => ({
  queryKey: queryKeys.files(owner, repo, number),
  enabled,
  queryFn: async (): Promise<PullFile[]> => readJson<PullFile[]>(apiRoutes.files(owner, repo, number)),
})
