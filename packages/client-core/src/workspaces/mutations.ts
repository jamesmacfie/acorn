// Workspace and repo-visibility writes (docs/workspaces-and-tasks.md). Core owns these: a workspace is
// a named group of repos in the local mirror, not a GitHub concept, and every route helper below
// already lives in core/shared/api.ts. Callers invalidate workspacesKey / reposKey after.
import { postJson, writeJson } from '../apiClient'
import {
  type Workspace,
  type WorkspaceIcon,
  workspaceProjectsRoute,
  type WorkspaceProject,
  workspaceRoute,
  workspacesRoute,
  workspaceBootstrapRoute,
  workspaceReposRoute,
  workspaceIgnoreRepoRoute,
  workspaceUnignoreRepoRoute,
  workspaceIgnoreAllRoute,
} from '@acorn/protocol/api.ts'

import { pinsRoute } from '../githubShellReads'

// Replace a workspace's combined external-project set. Provider-specific callers merge their slice
// first via integrations/workspaceProjects.ts so sibling-provider mappings survive.
export const setWorkspaceProjects = async (workspaceId: string, projects: WorkspaceProject[]) =>
  writeJson<{ ok: true }>(workspaceProjectsRoute(workspaceId), {
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
export const renameWorkspace = async (id: string, name: string) => patchWorkspace(id, { name })
// Build/run/db/preview config is repository-scoped — edit it via the desktop bridge's repoPath.config.
// Only workspace identity is patched here: icon (null clears) and colour (preset token or hex; null clears).
export const setWorkspaceIcon = async (id: string, icon: WorkspaceIcon | null) => patchWorkspace(id, { icon })
export const setWorkspaceColor = async (id: string, color: string | null) => patchWorkspace(id, { color })
export const deleteWorkspace = async (id: string) =>
  writeJson<{ ok: true }>(workspaceRoute(id), { method: 'DELETE' }, (res) => `workspace ${res.status}`)

// Move a repo into a workspace (partition; upsert on owner/repo). Also un-ignores it.
export const setRepoWorkspace = (workspaceId: string, owner: string, name: string) =>
  postJson<{ ok: true }>(workspaceReposRoute(workspaceId), { owner, name })
// Hide a repo (keeps its workspace membership; excluded from selector/rail/scoping). Reversible.
export const ignoreRepo = (owner: string, name: string) => postJson<{ ok: true }>(workspaceIgnoreRepoRoute, { owner, name })
export const unignoreRepo = (owner: string, name: string) => postJson<{ ok: true }>(workspaceUnignoreRepoRoute, { owner, name })
// Hide or show every repo at once (onboarding master toggle).
export const setAllReposIgnored = (ignored: boolean) => postJson<{ ok: true }>(workspaceIgnoreAllRoute, { ignored })

// Pin a repo to the top of the picker — repo visibility, same family as ignore/unignore.
export const setPin = async (repoId: number, pinned: boolean) =>
  writeJson<{ repoId: number; pinned: boolean }>(
    pinsRoute,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repoId, pinned }) },
    (res) => `pins ${res.status}`,
  )
