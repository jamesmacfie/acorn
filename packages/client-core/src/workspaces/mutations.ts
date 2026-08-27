// Workspace and Project writes (docs/workspaces-and-tasks.md). Core owns these, and callers invalidate
// the core workspace/project keys after mutations.
import { postJson, writeJson } from '../apiClient'
import {
  integrationMappingsRoute,
  type IntegrationMapping,
  projectDetectRoute,
  projectRoute,
  projectsRoute,
  type Workspace,
  workspaceExternalProjectsRoute,
  type WorkspaceExternalProject,
  workspaceRoute,
  workspacesRoute,
  workspaceBootstrapRoute,
} from '@acorn/protocol/api.ts'
import type { Project, ProjectPatch, ProjectSeed } from '@acorn/protocol/api.ts'

// Replace a workspace's combined external-project set. Provider-specific callers merge their slice
// first via integrations/workspaceProjects.ts so sibling-provider mappings survive.
export const setWorkspaceExternalProjects = async (workspaceId: string, projects: WorkspaceExternalProject[]) =>
  writeJson<{ ok: true }>(workspaceExternalProjectsRoute(workspaceId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projects }),
  }, (response) => `workspace-projects ${response.status}`)

// Replace one connection's whole map in a single write. The connection-side twin of the call above:
// Settings edits an integration rather than a workspace at a time, and scoping the replace to the
// connection is what keeps a sibling integration's rows out of it.
export const setIntegrationMappings = async (connectionId: string, mappings: IntegrationMapping[]) =>
  writeJson<{ ok: true }>(integrationMappingsRoute(connectionId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mappings }),
  }, (response) => `integration-mappings ${response.status}`)

const patchWorkspace = (id: string, body: unknown) =>
  writeJson<{ ok: true }>(
    workspaceRoute(id),
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    (res) => `workspace ${res.status}`,
  )

export const bootstrapWorkspaces = () => postJson<Workspace[]>(workspaceBootstrapRoute)
export const createWorkspace = (name: string) => postJson<Workspace>(workspacesRoute, { name })
export const createProject = (seed: ProjectSeed) => postJson<{ project: Project }>(projectsRoute, seed)
export const patchProject = (id: string, patch: ProjectPatch) =>
  writeJson<{ project: Project }>(projectRoute(id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }, (res) => `project ${res.status}`)
export const detectProject = (id: string) => postJson<{ project: Project }>(projectDetectRoute(id))
// Takes the project's tasks with it (main/projects.ts). Folders and worktrees on disk are untouched.
export const deleteProject = (id: string) =>
  writeJson<{ ok: true }>(projectRoute(id), { method: 'DELETE' }, (res) => `project ${res.status}`)
export const setProjectWorkspace = (id: string, workspaceId: string) => patchProject(id, { workspaceId })
export const setProjectHidden = (id: string, hidden: boolean) => patchProject(id, { hidden })
export const renameWorkspace = async (id: string, name: string) => patchWorkspace(id, { name })
// Build/run/db/preview config and project colour are Project-scoped; edit them via the Project API.
export const deleteWorkspace = async (id: string) =>
  writeJson<{ ok: true }>(workspaceRoute(id), { method: 'DELETE' }, (res) => `workspace ${res.status}`)
