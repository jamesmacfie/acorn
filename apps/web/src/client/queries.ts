// Shared TanStack Query definitions. Two consumers each (dropdown + PR list both read repos),
// so the options live here to avoid drift. All reads are same-origin cookie-auth; 401 on /me
// is a valid logged-out state, elsewhere it's an error.
import { readJson } from './apiClient'
import {
  filesKey,
  meKey,
  meRoute,
  pinsKey,
  pinsRoute,
  prefsKey,
  prefsRoute,
  pullKey,
  pullRoute,
  pullsKey,
  pullsRoute,
  reposKey,
  reposRoute,
  type Me,
  type Pull,
  type PullDetail,
  type PullFile,
  type Repo,
} from '../shared/api'

export { meKey, pinsKey, prefsKey, pullKey, pullPrefixKey, pullsPrefixKey, reposKey, reposRefreshRoute } from '../shared/api'
export type { Check, Comment, Label, Me, Pull, PullDetail, PullFile, Repo, Review, Thread, ThreadComment } from '../shared/api'

export const meOptions = () => ({
  queryKey: meKey,
  queryFn: async (): Promise<Me | null> => readJson<Me | null>(meRoute, { nullOn401: true }),
})

export const reposOptions = (enabled: boolean) => ({
  queryKey: reposKey,
  enabled,
  queryFn: async (): Promise<Repo[]> => readJson<Repo[]>(reposRoute),
})

export const pullsOptions = (owner: string, repo: string, state: 'open' | 'closed', enabled: boolean) => ({
  queryKey: pullsKey(owner, repo, state),
  enabled,
  queryFn: async (): Promise<Pull[]> => readJson<Pull[]>(pullsRoute(owner, repo, state)),
})

export const pullDetailOptions = (owner: string, repo: string, number: string, enabled: boolean) => ({
  queryKey: pullKey(owner, repo, number),
  enabled,
  queryFn: async (): Promise<PullDetail> => readJson<PullDetail>(pullRoute(owner, repo, number)),
})

export const pinsOptions = (enabled: boolean) => ({
  queryKey: pinsKey,
  enabled,
  queryFn: async (): Promise<number[]> => readJson<number[]>(pinsRoute),
})

export const prefsOptions = (enabled: boolean) => ({
  queryKey: prefsKey,
  enabled,
  queryFn: async (): Promise<Record<string, string>> => readJson<Record<string, string>>(prefsRoute),
})

export const filesOptions = (owner: string, repo: string, number: string, enabled: boolean) => ({
  queryKey: filesKey(owner, repo, number),
  enabled,
  queryFn: async (): Promise<PullFile[]> => readJson<PullFile[]>(pullRoute(owner, repo, number, 'files')),
})
