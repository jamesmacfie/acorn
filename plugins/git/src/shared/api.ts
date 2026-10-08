export type WorktreeOwner = { id: string; title: string; projectId: string }

export type Worktree = {
  path: string
  head: string | null
  branch: string | null
  main: boolean
  locked: boolean
  prunable: boolean
  missing: boolean
  dirty: boolean | null
  changedFiles: string[]
  filesTruncated: boolean
  lastCommit: { subject: string; at: number } | null
  owners: WorktreeOwner[]
  error: string | null
  observation: string
}

export type WorktreeInventory = {
  projectId: string
  repository: string | null
  worktrees: Worktree[]
  error: string | null
  observedAt: number
}

export type CleanupRequest = { observation: string }
export type CleanupResult = { ok: boolean; error?: string; inventory: WorktreeInventory }

export const inventoryRoute = (projectId: string) => `/v1/p/git/projects/${encodeURIComponent(projectId)}/worktrees`
export const cleanupRoute = (projectId: string, observation: string) => `${inventoryRoute(projectId)}/${encodeURIComponent(observation)}/remove`
