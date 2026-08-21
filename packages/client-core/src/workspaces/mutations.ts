// Workspace and Project writes (docs/workspaces-and-tasks.md). Core owns these, and callers invalidate
// the core workspace/project keys after mutations.
import { postJson, writeJson } from '../apiClient'
import {
  projectDetectRoute,
  projectRoute,
  projectsRoute,
  type Workspace,
  type WorkspaceIcon,
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
// Build/run/db/preview config is Project-scoped; edit it via the Project API/bridge.
// Only workspace identity is patched here: icon (null clears) and colour (preset token or hex; null clears).
export const setWorkspaceIcon = async (id: string, icon: WorkspaceIcon | null) => patchWorkspace(id, { icon })
export const setWorkspaceColor = async (id: string, color: string | null) => patchWorkspace(id, { color })
export const deleteWorkspace = async (id: string) =>
  writeJson<{ ok: true }>(workspaceRoute(id), { method: 'DELETE' }, (res) => `workspace ${res.status}`)
