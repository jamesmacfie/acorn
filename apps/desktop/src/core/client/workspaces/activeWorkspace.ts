// Workspace (group) selection is derived, not stored: a repo belongs to exactly one workspace
// (partition), so the active workspace is whichever one contains the current repo. No extra state,
// no URL dimension — selecting a workspace just navigates to one of its repos (docs/workspaces).
import type { Workspace } from '../queries'

export function workspaceForRepo(list: Workspace[] | undefined, owner?: string, name?: string): Workspace | null {
  if (!list || !owner || !name) return null
  return list.find((w) => (w.repos ?? []).some((r) => r.owner === owner && r.name === name)) ?? null
}
