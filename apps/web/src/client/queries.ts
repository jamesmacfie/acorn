// Shared TanStack Query definitions. Two consumers each (dropdown + PR list both read repos),
// so the options live here to avoid drift. All reads are same-origin cookie-auth; 401 on /me
// is a valid logged-out state, elsewhere it's an error.
import { readJson, writeJson } from './apiClient'
import {
  branchesKey,
  branchesRoute,
  compareKey,
  compareRoute,
  fileBlobKey,
  fileBlobRoute,
  filePatchKey,
  filePatchRoute,
  filePatchesRoute,
  fileSummariesKey,
  fileSummariesRoute,
  filesKey,
  meKey,
  meRoute,
  mentionsKey,
  mentionsRoute,
  pinsKey,
  pinsRoute,
  prefsKey,
  prefsRoute,
  closedPullsKey,
  closedPullsRoute,
  pullKey,
  pullRoute,
  pullsKey,
  pullsRoute,
  reposKey,
  reposRoute,
  type Branch,
  type ClosedPullsPage,
  type Compare,
  type FileBlob,
  type Me,
  type Pull,
  type PullDetail,
  type PullFile,
  type PullFilesPatchRequest,
  type Repo,
} from '../shared/api'

export {
  filePatchKey,
  fileSummariesKey,
  meKey,
  pinsKey,
  prefsKey,
  pullKey,
  pullPrefixKey,
  pullsKey,
  pullsPrefixKey,
  reposKey,
  reposRefreshRoute,
} from '../shared/api'
export type { Branch, Check, Comment, Compare, CompareCommit, Label, Me, Pull, PullDetail, PullFile, Repo, Review, Thread, ThreadComment } from '../shared/api'

type QueryContext = { signal?: AbortSignal }
type PageQueryContext = QueryContext & { pageParam: number }

export const meOptions = () => ({
  queryKey: meKey,
  queryFn: async ({ signal }: QueryContext): Promise<Me | null> => readJson<Me | null>(meRoute, { nullOn401: true, signal }),
})

export const reposOptions = (enabled: boolean) => ({
  queryKey: reposKey,
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<Repo[]> => readJson<Repo[]>(reposRoute, { signal }),
})

export const pullsOptions = (owner: string, repo: string, state: 'open' | 'closed', enabled: boolean) => ({
  queryKey: pullsKey(owner, repo, state),
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<Pull[]> => readJson<Pull[]>(pullsRoute(owner, repo, state), { signal }),
})

// Closed PRs paginate on demand: one GitHub page per fetch, load-more advances pageParam.
export const closedPullsInfiniteOptions = (owner: string, repo: string, enabled: boolean) => ({
  queryKey: closedPullsKey(owner, repo),
  enabled,
  initialPageParam: 1,
  queryFn: async ({ pageParam, signal }: PageQueryContext): Promise<ClosedPullsPage> =>
    readJson<ClosedPullsPage>(closedPullsRoute(owner, repo, pageParam), { signal }),
  getNextPageParam: (last: ClosedPullsPage) => last.nextPage ?? undefined,
})

export const pullDetailOptions = (owner: string, repo: string, number: string, enabled: boolean) => ({
  queryKey: pullKey(owner, repo, number),
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<PullDetail> => readJson<PullDetail>(pullRoute(owner, repo, number), { signal }),
})

export const pinsOptions = (enabled: boolean) => ({
  queryKey: pinsKey,
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<number[]> => readJson<number[]>(pinsRoute, { signal }),
})

export const prefsOptions = (enabled: boolean) => ({
  queryKey: prefsKey,
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<Record<string, string>> => readJson<Record<string, string>>(prefsRoute, { signal }),
})

export const filesOptions = (owner: string, repo: string, number: string, enabled: boolean) => ({
  queryKey: filesKey(owner, repo, number),
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<PullFile[]> => readJson<PullFile[]>(pullRoute(owner, repo, number, 'files'), { signal }),
})

export const fileSummariesOptions = (owner: string, repo: string, number: string, enabled: boolean) => ({
  queryKey: fileSummariesKey(owner, repo, number),
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<PullFile[]> => readJson<PullFile[]>(fileSummariesRoute(owner, repo, number), { signal }),
})

export const filePatchOptions = (owner: string, repo: string, number: string, path: string) => ({
  queryKey: filePatchKey(owner, repo, number, path),
  queryFn: async ({ signal }: QueryContext): Promise<PullFile> => {
    const [file] = await readJson<PullFile[]>(filePatchRoute(owner, repo, number, path), { signal })
    if (!file) throw new Error('file_not_found')
    return file
  },
})

export const fetchFilePatches = (owner: string, repo: string, number: string, paths: string[], signal?: AbortSignal): Promise<PullFile[]> =>
  writeJson<PullFile[]>(
    filePatchesRoute(owner, repo, number),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths } satisfies PullFilesPatchRequest),
      signal,
    },
    'files_patch_failed',
  )

// Branch names for the create-PR pickers; enabled once the repo is known.
export const branchesOptions = (owner: string, repo: string, enabled: boolean) => ({
  queryKey: branchesKey(owner, repo),
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<Branch[]> => readJson<Branch[]>(branchesRoute(owner, repo), { signal }),
})

// base..head compare for the create view (diff preview + commits for title prefill).
export const compareOptions = (owner: string, repo: string, base: string, head: string, enabled: boolean) => ({
  queryKey: compareKey(owner, repo, base, head),
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<Compare> => readJson<Compare>(compareRoute(owner, repo, base, head), { signal }),
})

// Full head-blob body, fetched on demand (queryClient.fetchQuery) when a gap is expanded. The sha
// is immutable so the body never goes stale — fetch once per file, reuse for every gap.
export const fileBlobOptions = (owner: string, repo: string, sha: string) => ({
  queryKey: fileBlobKey(owner, repo, sha),
  staleTime: Infinity,
  queryFn: async ({ signal }: QueryContext): Promise<FileBlob> => readJson<FileBlob>(fileBlobRoute(owner, repo, sha), { signal }),
})

// Distinct participant logins for the repo — used to populate @mention autocomplete.
export const mentionsOptions = (owner: string, repo: string, enabled: boolean) => ({
  queryKey: mentionsKey(owner, repo),
  enabled,
  staleTime: 5 * 60 * 1000,
  queryFn: async ({ signal }: QueryContext): Promise<string[]> => readJson<string[]>(mentionsRoute(owner, repo), { signal }),
})
