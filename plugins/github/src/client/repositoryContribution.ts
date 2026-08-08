import { readJson, postJson, writeJson } from '@acorn/client-core/apiClient.ts'
import type { SourceRepository } from '@acorn/client-core/registries/sources.ts'
import { pinsRoute, pullRoute, reposRefreshRoute, reposRoute, type Check, type Repo } from '../contract/api'

type PullChecks = { checks: Check[] }

// The shell's shared repository reads are still owned by GitHub, but their routes and wire shapes stay
// here. Core wraps this contribution in generic TanStack query options so the source can be replaced
// without making the shell import this plugin.
export const githubRepositoryContribution: SourceRepository = {
  repos: ({ signal }) => readJson<Repo[]>(reposRoute, { signal }),
  pins: ({ signal }) => readJson<number[]>(pinsRoute, { signal }),
  refreshRepos: async () => {
    await postJson(reposRefreshRoute)
  },
  setPin: async (repoId, pinned) => {
    await writeJson<{ repoId: number; pinned: boolean }>(
      pinsRoute,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repoId, pinned }) },
      (res) => `pins ${res.status}`,
    )
  },
  pullChecks: (owner, repo, number, { signal }) => readJson<PullChecks>(pullRoute(owner, repo, number), { signal }),
}
