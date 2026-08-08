// Workspace (group) selection is derived, not stored: a project belongs to exactly one workspace
// (partition), so the active workspace is whichever one contains the current project. No extra state,
// no URL dimension — selecting a workspace just navigates to one of its projects
// (docs/workspaces-and-tasks.md).
import type { Workspace } from '../queries'

export function workspaceForProject(list: Workspace[] | undefined, projectId?: string): Workspace | null {
  if (!list || !projectId) return null
  return list.find((workspace) => workspace.projects.some((project) => project.id === projectId)) ?? null
}
