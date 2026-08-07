// The GitHub surface the SHELL still reads directly — collected in one file on purpose.
//
// plugins/github owns every path, key and shape below (plugins/github/src/contract/api.ts). They are
// duplicated here rather than imported because client-core is a shared library and may not import a
// plugin; the arch suite enforces that, and it is the rule that stops the shell depending on
// features.
//
// The duplication is the symptom. The disease is finding 10: the shell is GitHub-shaped. Core's repo
// picker lists GitHub repos, core's workspace screens assign them, and core's tab rail renders a PR's
// check status — all with `github` hardcoded rather than asking a registry which provider supplies a
// repo list or a task's status. Every one of those is a contribution waiting to be declared.
//
// So this file is a ledger, not a home. When finding 10 lands, it should be DELETED, not moved:
// each read here becomes a contribution from the plugin that can answer it. Keeping them in one place
// makes that job legible and stops the literals from scattering back across the shell.
import { readJson } from './apiClient'

type QueryContext = { signal?: AbortSignal }

export const reposRoute = '/v2/p/github/repos'
export const reposRefreshRoute = '/v2/p/github/repos/refresh'
export const pinsRoute = '/v2/p/github/pins'
export const reposKey = ['repos'] as const
export const pinsKey = ['pins'] as const
const pullRoute = (owner: string, repo: string, number: string) => `/v2/p/github/repos/${owner}/${repo}/pulls/${number}`
const pullKey = (owner: string, repo: string, number: string) => ['pull', owner, repo, number] as const

// What the repo picker and the workspace-assignment screens need off a repo row. A subset of github's
// `Repo`, declared structurally so the plugin's fuller type satisfies it.
export type ShellRepo = {
  id: number
  owner: string
  name: string
  private: boolean
  pushedAt: number | null
}

// What the tab rail needs off a PR: its check runs, to render a status dot. Nothing else.
export type ShellPullChecks = { checks: Array<{ name: string; status: string | null; url: string | null; runId: number | null }> }

export const reposOptions = (enabled: boolean) => ({
  queryKey: reposKey,
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<ShellRepo[]> => readJson<ShellRepo[]>(reposRoute, { signal }),
})

// The repo picker's companion read: which repos the owner has pinned to the top of the list. Used by
// the shell's picker and by plugins/http's, which reuses it.
export const pinsOptions = (enabled: boolean) => ({
  queryKey: pinsKey,
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<number[]> => readJson<number[]>(pinsRoute, { signal }),
})

// The tab rail's read. Same key as the plugin's own pullDetailOptions, deliberately: they address the
// same cache entry, and diverging would double-fetch every open PR tab.
export const shellPullChecksOptions = (owner: string, repo: string, number: string, enabled: boolean) => ({
  queryKey: pullKey(owner, repo, number),
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<ShellPullChecks> =>
    readJson<ShellPullChecks>(pullRoute(owner, repo, number), { signal }),
})
