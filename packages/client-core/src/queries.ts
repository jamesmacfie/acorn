// Core's TanStack Query definitions: tasks, projects, workspaces, prefs, integrations. Every
// read goes through the broker's device bearer; 401 on /me is a valid logged-out state, elsewhere it
// is an error.
//
// Provider-specific routes and wire types stay with their plugins. The shell owns only core-backed
// project, task, workspace, preference, and integration queries.
import { readJson } from './apiClient'
import { homeNodeTarget } from './node/fleet'
import { mergePrefs, seedDevicePrefs } from './persistence/devicePrefs'
import { integrationsKey, integrationsRoute, projectsKey, projectsRoute, workspaceExternalProjectsRoute, type Project, type ProjectsResponse, prefsKey, prefsRoute, tasksKey, tasksRoute, type Task, workspacesKey, workspacesRoute, type Workspace, type IntegrationsResponse, type WorkspaceExternalProjectsResponse } from '@acorn/protocol/api.ts'

export { integrationsKey, prefsKey, projectsKey, tasksKey, workspacesKey } from '@acorn/protocol/api.ts'
export type { Integration, IntegrationsResponse, Project, ProjectsResponse, Task, TaskLink, TaskSeed, Workspace, WorkspaceExternalProject } from '@acorn/protocol/api.ts'

type QueryContext = { signal?: AbortSignal }

// Active tasks for the rail (docs/workspaces-and-tasks.md). Source of truth is us; refetch on focus
// keeps the dirty/PR-inherited markers fresh as the mirror syncs.
export const tasksOptions = (enabled: boolean) => ({
  queryKey: tasksKey,
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<Task[]> => readJson<Task[]>(tasksRoute, { signal }),
})

// Workspaces (named groups of Projects) for the top selector. Each carries its project membership.
export const workspacesOptions = (enabled: boolean) => ({
  queryKey: workspacesKey,
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<Workspace[]> => readJson<Workspace[]>(workspacesRoute, { signal }),
})

// Projects are the client-facing folder identity. The response includes hidden and path-null rows so
// Settings can repair mappings while the rail filters them for display.
export const projectsOptions = (enabled: boolean) => ({
  queryKey: projectsKey,
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<Project[]> => (await readJson<ProjectsResponse>(projectsRoute, { signal })).projects,
})

// External projects linked to a workspace (docs/workspaces-and-tasks.md): (integrationId, externalId) pairs.
export const workspaceExternalProjectsKey = (id: string) => ['workspace-external-projects', id] as const
export const workspaceExternalProjectsOptions = (workspaceId: string | null, enabled: boolean) => ({
  queryKey: workspaceExternalProjectsKey(workspaceId ?? ''),
  enabled: enabled && !!workspaceId,
  queryFn: async ({ signal }: QueryContext): Promise<WorkspaceExternalProjectsResponse> =>
    readJson<WorkspaceExternalProjectsResponse>(workspaceExternalProjectsRoute(workspaceId as string), { signal }),
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
