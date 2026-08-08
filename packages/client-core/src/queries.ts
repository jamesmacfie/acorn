// Core's TanStack Query definitions: tasks, workspaces, repo assignments, prefs, integrations. Every
// read goes through the broker's device bearer; 401 on /me is a valid logged-out state, elsewhere it
// is an error.
//
// Provider-specific routes and wire types stay with their plugins. The shell query wrappers below use
// the repository source contribution for the shared picker/status reads.
import { readJson } from './apiClient'
import { repositorySource, type SourcePullChecks, type SourceRepo } from './registries/sources'
import { homeNodeTarget } from './node/fleet'
import { mergePrefs, seedDevicePrefs } from './persistence/devicePrefs'
import { integrationsKey, integrationsRoute, workspaceProjectsRoute, workspaceAssignmentsRoute, workspaceAssignmentsKey, type RepoAssignment, prefsKey, prefsRoute, tasksKey, tasksRoute, type Task, workspacesKey, workspacesRoute, type Workspace, type IntegrationsResponse, type WorkspaceProjectsResponse } from '@acorn/protocol/api.ts'

export { integrationsKey, prefsKey, tasksKey, workspacesKey } from '@acorn/protocol/api.ts'
export type { Integration, IntegrationsResponse, Task, TaskLink, TaskSeed, Workspace, WorkspaceProject, WorkspaceRepo } from '@acorn/protocol/api.ts'

type QueryContext = { signal?: AbortSignal }

export type ShellRepo = SourceRepo
export type ShellPullChecks = SourcePullChecks
export const reposKey = ['repos'] as const
export const pinsKey = ['pins'] as const
const pullKey = (owner: string, repo: string, number: string) => ['pull', owner, repo, number] as const

export const reposOptions = (enabled: boolean) => ({
  queryKey: reposKey,
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<ShellRepo[]> => repositorySource()?.repos({ signal }) ?? [],
})

export const pinsOptions = (enabled: boolean) => ({
  queryKey: pinsKey,
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<number[]> => repositorySource()?.pins({ signal }) ?? [],
})

export const refreshRepos = async (): Promise<void> => {
  const source = repositorySource()
  if (!source) throw new Error('repository source unavailable')
  await source.refreshRepos()
}

export const setRepoPin = async (repoId: number, pinned: boolean): Promise<void> => {
  const source = repositorySource()
  if (!source) throw new Error('repository source unavailable')
  await source.setPin(repoId, pinned)
}

export const shellPullChecksOptions = (owner: string, repo: string, number: string, enabled: boolean) => ({
  queryKey: pullKey(owner, repo, number),
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<ShellPullChecks> => repositorySource()?.pullChecks(owner, repo, number, { signal }) ?? { checks: [] },
})

// Active tasks for the rail (docs/workspaces-and-tasks.md). Source of truth is us; refetch on focus
// keeps the dirty/PR-inherited markers fresh as the mirror syncs.
export const tasksOptions = (enabled: boolean) => ({
  queryKey: tasksKey,
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<Task[]> => readJson<Task[]>(tasksRoute, { signal }),
})

// Workspaces (named groups of repos) for the top selector. Each carries its repo membership.
export const workspacesOptions = (enabled: boolean) => ({
  queryKey: workspacesKey,
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<Workspace[]> => readJson<Workspace[]>(workspacesRoute, { signal }),
})

// Per-repo workspace assignment + hidden flag, for the onboarding modal (docs/workspaces-and-tasks.md).
export { workspaceAssignmentsKey } from '@acorn/protocol/api.ts'
export type { RepoAssignment } from '@acorn/protocol/api.ts'
export const assignmentsOptions = (enabled: boolean) => ({
  queryKey: workspaceAssignmentsKey,
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<RepoAssignment[]> => readJson<RepoAssignment[]>(workspaceAssignmentsRoute, { signal }),
})

// External projects linked to a workspace (docs/workspaces-and-tasks.md): (integrationId, externalId) pairs
// spanning any number of integrations. One project → many repos via the workspace grouping.
export const workspaceProjectsKey = (id: string) => ['workspace-projects', id] as const
export const workspaceProjectsOptions = (workspaceId: string | null, enabled: boolean) => ({
  queryKey: workspaceProjectsKey(workspaceId ?? ''),
  enabled: enabled && !!workspaceId,
  queryFn: async ({ signal }: QueryContext): Promise<WorkspaceProjectsResponse> =>
    readJson<WorkspaceProjectsResponse>(workspaceProjectsRoute(workspaceId as string), { signal }),
})

export const prefsOptions = (enabled: boolean) => ({
  queryKey: prefsKey,
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<Record<string, string>> => {
    const nodePrefs = await readJson<Record<string, string>>(prefsRoute, { signal, ...homeNodeTarget() })
    seedDevicePrefs(nodePrefs)
    return mergePrefs(nodePrefs)
  },
})

// Connected integrations (gates the Sources rail + settings list). Includes the synthesized GitHub
// entry.
export const integrationsOptions = (enabled: boolean) => ({
  queryKey: integrationsKey,
  enabled,
  staleTime: 5 * 60 * 1000,
  queryFn: async ({ signal }: QueryContext): Promise<IntegrationsResponse> => readJson<IntegrationsResponse>(integrationsRoute, { signal }),
})
