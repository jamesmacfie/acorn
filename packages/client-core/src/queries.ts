// Core's TanStack Query definitions: tasks, projects, workspaces, prefs, integrations. Every
// read goes through the broker's device bearer; 401 on /me is a valid logged-out state, elsewhere it
// is an error.
//
// Provider-specific routes and wire types stay with their plugins. The shell owns only core-backed
// project, task, workspace, preference, and integration queries.
import { readJson } from './apiClient'
import { activeNodeId } from './node/activeNode'
import { drainMigratedPrefs, mergePrefs, seedDevicePrefs } from './persistence/devicePrefs'
import { setPref } from './settings/savePref'
import { integrationProjectsRoute, integrationsKey, integrationsRoute, projectsKey, projectsRoute, workspaceExternalProjectsRoute, type IntegrationProject, type IntegrationProjectsResponse, type Project, type ProjectsResponse, prefsKey, prefsRoute, tasksKey, tasksRoute, type Task, workspacesKey, workspacesRoute, type Workspace, type IntegrationsResponse, type WorkspaceExternalProjectsResponse } from '@acorn/protocol/api.ts'

export { integrationsKey, prefsKey, projectsKey, tasksKey, workspacesKey } from '@acorn/protocol/api.ts'
export type { Integration, IntegrationProject, IntegrationsResponse, Project, ProjectsResponse, Task, TaskLink, TaskSeed, Workspace, WorkspaceExternalProject } from '@acorn/protocol/api.ts'

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

// The projects ONE connection offers, for the workspace mapping picker
// (settings/WorkspaceExternalProjects.tsx). Per connection, so a provider that is down shows its own
// error row and its siblings still list.
//
// No staleTime and no retry, both deliberate. A picker's list is a claim about the provider now — the
// surface this replaced had to reach past a five-minute cache by hand to get that — and a connection
// that failed should say so at once with a Retry button rather than after three silent attempts.
export const integrationProjectsKey = (connectionId: string) => ['integration-projects', connectionId] as const
export const integrationProjectsOptions = (connectionId: string, enabled: boolean) => ({
  queryKey: integrationProjectsKey(connectionId),
  enabled: enabled && !!connectionId,
  retry: false,
  gcTime: 0,
  queryFn: async ({ signal }: QueryContext): Promise<IntegrationProject[]> =>
    (await readJson<IntegrationProjectsResponse>(integrationProjectsRoute(connectionId), { signal })).projects,
})

export const prefsOptions = (enabled: boolean) => ({
  queryKey: prefsKey,
  enabled,
  // The ACTIVE node's prefs. Everything left in this store describes that node's resources, and the
  // per-node QueryClient partition (node/fleet.ts) already keeps one node's answer out of another's.
  queryFn: async ({ signal }: QueryContext): Promise<Record<string, string>> => {
    const nodePrefs = await readJson<Record<string, string>>(prefsRoute, { signal })
    seedDevicePrefs(nodePrefs)
    // One-shot, and a no-op on every fetch after the first: hands back whatever composition state the
    // previous release seeded into this device's storage. Awaited rather than fired off, so the value
    // this query resolves with already includes it and the shell restores layouts on the first paint
    // rather than the second.
    const drained = await drainMigratedPrefs(activeNodeId(), nodePrefs, setPref)
    return mergePrefs({ ...nodePrefs, ...drained })
  },
  // A persisted TanStack snapshot can hydrate without running queryFn while it is still fresh. Device
  // preferences live outside that cache, so project them at read time as well or a just-saved shortcut
  // can disappear from every consumer until the node-backed query refetches.
  select: (prefs: Record<string, string>): Record<string, string> => mergePrefs(prefs),
})

// Connected integrations (gates the Sources rail + settings list). Includes the synthesized GitHub
// entry.
export const integrationsOptions = (enabled: boolean) => ({
  queryKey: integrationsKey,
  enabled,
  staleTime: 5 * 60 * 1000,
  queryFn: async ({ signal }: QueryContext): Promise<IntegrationsResponse> => readJson<IntegrationsResponse>(integrationsRoute, { signal }),
})
