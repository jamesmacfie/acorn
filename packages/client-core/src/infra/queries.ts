// Core's TanStack Query definitions: tasks, projects, workspaces, prefs, integrations. Every
// read goes through the broker's device bearer; 401 on /me is a valid logged-out state, elsewhere it
// is an error.
//
// Provider-specific routes and wire types stay with their plugins. The shell owns only core-backed
// project, task, workspace, preference, and integration queries.
import type { ModelBackendsResponse } from '@acorn/protocol/modelProviders.ts'
import type { RunTargetInfo } from '@acorn/protocol/runTargets.ts'
import { readJson } from './node/apiClient'
import { mergePrefs } from './persistence/devicePrefs'
import { coreTelemetrySummaryRoute, type TelemetrySummary, integrationMappingsRoute, integrationProjectsRoute, integrationsKey, integrationsRoute, modelBackendsKey, modelBackendsRoute, projectsKey, projectsRoute, workspaceExternalProjectsRoute, type IntegrationMapping, type IntegrationMappingsResponse, type IntegrationProject, type IntegrationProjectsResponse, type Project, type ProjectsResponse, prefsKey, prefsRoute, runTargetsRoute, tasksKey, tasksRoute, archivedTasksRoute, type ArchivedTask, type Task, workspacesKey, workspacesRoute, type Workspace, type IntegrationsResponse, type WorkspaceExternalProjectsResponse } from '@acorn/protocol/api.ts'

export { integrationsKey, modelBackendsKey, prefsKey, projectsKey, tasksKey, workspacesKey } from '@acorn/protocol/api.ts'
export type { ArchivedTask, Integration, IntegrationMapping, IntegrationProject, IntegrationsResponse, Project, ProjectsResponse, Task, TaskLink, TaskSeed, Workspace, WorkspaceExternalProject } from '@acorn/protocol/api.ts'

type QueryContext = { signal?: AbortSignal }

// Active tasks for the rail (docs/workspaces-and-tasks.md). Source of truth is us; refetch on focus
// keeps the dirty/PR-inherited markers fresh as the mirror syncs.
export const tasksOptions = (enabled: boolean) => ({
  queryKey: tasksKey,
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<Task[]> => readJson<Task[]>(tasksRoute, { signal }),
})

// Archived tasks for the archive page, newest first. Keyed under tasksKey so every invalidation of the
// active list, including `tasks:changed`, refreshes this one too.
export const archivedTasksKey = [...tasksKey, 'archived'] as const
export const archivedTasksOptions = (enabled: boolean) => ({
  queryKey: archivedTasksKey,
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<ArchivedTask[]> => readJson<ArchivedTask[]>(archivedTasksRoute, { signal }),
})

// One task's run targets, for the run buttons in the task's pane switcher. A visit draws the cached
// list in the same frame as the panes, so the buttons no longer arrive late and push the switcher
// down, and asks the node again once the shell's 30-second stale time has passed. `run:changed`
// refreshes one task's entry (node/watchNodeEvents.ts) and `project:changed` every entry
// (projects/watchProjectChanges.ts). Nothing reports a hand edit to `.acorn/config.toml`, so the stale
// time and window focus are what pick one up. A configuration the node cannot read answers with no
// buttons, as the task view always did.
export const runTargetsKey = ['run-targets'] as const
export const runTargetsOptions = (taskId: string, enabled: boolean) => ({
  queryKey: [...runTargetsKey, taskId] as const,
  enabled,
  queryFn: async ({ signal }: QueryContext): Promise<RunTargetInfo[]> => {
    const result = await readJson<{ targets: RunTargetInfo[] } | { error: string }>(runTargetsRoute(taskId), { signal })
    return 'targets' in result ? result.targets : []
  },
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

// The projects one connection offers, for the workspace mapping picker
// (settings/ConnectionProjectMap.tsx). Per connection, so a provider that is down shows its
// own error row and its siblings still list.
//
// No staleTime and no retry. A picker's list is a claim about the provider now (the surface this
// replaced had to reach past a five-minute cache by hand to get that), and a connection that
// failed should say so at once with a Retry button rather than after three silent attempts.
export const integrationProjectsKey = (connectionId: string) => ['integration-projects', connectionId] as const
export const integrationProjectsOptions = (connectionId: string, enabled: boolean) => ({
  queryKey: integrationProjectsKey(connectionId),
  enabled: enabled && !!connectionId,
  retry: false,
  gcTime: 0,
  queryFn: async ({ signal }: QueryContext): Promise<IntegrationProject[]> =>
    (await readJson<IntegrationProjectsResponse>(integrationProjectsRoute(connectionId), { signal })).projects,
})

// Where one connection's external projects show up: (workspace, external project, optional project)
// rows, read from the connection's side so Settings can draw its whole map at once
// (settings/ConnectionProjectMap.tsx). Core's table, so it stays a core query.
export const integrationMappingsRootKey = ['integration-mappings'] as const
export const integrationMappingsKey = (connectionId: string) => [...integrationMappingsRootKey, connectionId] as const
export const integrationMappingsOptions = (connectionId: string, enabled: boolean) => ({
  queryKey: integrationMappingsKey(connectionId),
  enabled: enabled && !!connectionId,
  queryFn: async ({ signal }: QueryContext): Promise<IntegrationMapping[]> =>
    (await readJson<IntegrationMappingsResponse>(integrationMappingsRoute(connectionId), { signal })).mappings,
})

export const prefsOptions = (enabled: boolean) => ({
  queryKey: prefsKey,
  enabled,
  // The per-node QueryClient partition keeps each node's answer separate. Device preferences are
  // projected by select, including when a persisted query hydrates without fetching.
  queryFn: async ({ signal }: QueryContext): Promise<Record<string, string>> =>
    readJson<Record<string, string>>(prefsRoute, { signal }),
  // A persisted TanStack snapshot can hydrate without running queryFn while it is still fresh. Device
  // preferences live outside that cache, so project them at read time as well or a just-saved shortcut
  // can disappear from every consumer until the node-backed query refetches.
  select: (prefs: Record<string, string>): Record<string, string> => mergePrefs(prefs),
})

// What Settings → Telemetry draws under the switch: counters from the node's collector, per owner
// and kind, plus who is subscribed (docs/telemetry/diagnosis.md § What the page shows).
//
// It refetches every five seconds while the page is open, which is the collector's own flush
// window. Counts that move while you watch are the evidence the switch is doing something, and a
// page that needed a reload to show that would be a page nobody believes.
//
// For a named node, because the page follows the settings header's node switcher rather than the
// window's active node. `null` is the node serving this window, when there is no fleet.
export const telemetrySummaryKey = ['telemetry-summary'] as const
export const telemetrySummaryOptions = (enabled: boolean, nodeId: string | null) => ({
  queryKey: [...telemetrySummaryKey, nodeId ?? ''] as const,
  enabled,
  refetchInterval: 5_000,
  queryFn: async ({ signal }: QueryContext): Promise<TelemetrySummary> =>
    readJson<TelemetrySummary>(coreTelemetrySummaryRoute, { signal, nodeId: nodeId ?? undefined }),
})

// One named node's own preference rows, with no device values merged in. For a settings page that
// reads a node other than the active one; the active node's rows, as every other reader sees them, are
// `prefsOptions` above.
export const nodePrefsKey = (nodeId: string | null) => ['node-prefs', nodeId ?? ''] as const
export const nodePrefsOptions = (nodeId: string | null) => ({
  queryKey: nodePrefsKey(nodeId),
  queryFn: async ({ signal }: QueryContext): Promise<Record<string, string>> =>
    readJson<Record<string, string>>(prefsRoute, { signal, nodeId: nodeId ?? undefined }),
})

// Connected integrations (gates the Sources rail + settings list). Includes the synthesized GitHub
// entry.
export const integrationsOptions = (enabled: boolean) => ({
  queryKey: integrationsKey,
  enabled,
  staleTime: 5 * 60 * 1000,
  queryFn: async ({ signal }: QueryContext): Promise<IntegrationsResponse> => readJson<IntegrationsResponse>(integrationsRoute, { signal }),
})

// Everything a Generate control can spend: every connected model-provider key, plus every agent CLI
// installed on this machine. Its own query rather than a projection of `integrationsOptions`, because
// half the answer is a question only the node can answer — whether `claude` is on PATH — and the node
// probes it per read (docs/integrations/model-providers.md § Model providers).
//
// A short `staleTime`, unlike the five minutes integrations get: installing a CLI is a trip to a
// terminal and back, and a list that took five minutes to notice would look broken.
export const modelBackendsOptions = (enabled: boolean) => ({
  queryKey: modelBackendsKey,
  enabled,
  staleTime: 30 * 1000,
  queryFn: async ({ signal }: QueryContext): Promise<ModelBackendsResponse> => readJson<ModelBackendsResponse>(modelBackendsRoute, { signal }),
})
