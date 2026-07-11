import { writeJson } from '../apiClient'
import { workspaceProjectsRoute, type WorkspaceProject } from '../../shared/api'

// Replace a workspace's combined external-project set. Provider-specific callers merge their slice
// first via integrations/workspaceProjects.ts so sibling-provider mappings survive.
export const setWorkspaceProjects = async (workspaceId: string, projects: WorkspaceProject[]) =>
  writeJson<{ ok: true }>(workspaceProjectsRoute(workspaceId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projects }),
  }, (response) => `workspace-projects ${response.status}`)
