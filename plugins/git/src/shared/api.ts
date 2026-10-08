export type WorktreeOwner = { id: string; title: string; projectId: string }

export type Worktree = {
  /** Stable repository-qualified canonical path identity for client selection. */
  id: string
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
  /** Mutable roster snapshot token required for cleanup. */
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

export type Commit = {
  id: string; parents: string[]; author: { name: string; email: string; at: number };
  committer: { name: string; email: string; at: number }; subject: string; message: string; refs: string[]
}
export type HistoryFilter = { ref: string | null; field: 'message' | 'author' | 'hash'; query: string }
export type HistoryPage = { commits: Commit[]; refs: string[]; nextCursor: string | null; observation: string; searched: number; limit: number; omitted: string | null }
export type RevisionFile = { path: string; oldPath: string | null; status: string; oldMode: string; newMode: string; oldId: string; newId: string; binary: boolean; omission: string | null }
export type RevisionDetail = { commit: Commit; base: string | null; files: RevisionFile[]; topology: import('@acorn/diff-document/document').DiffDocumentTopology; omitted: string | null }
export const historyRoute = (projectId: string) => `/v1/p/git/projects/${encodeURIComponent(projectId)}/history`
export const revisionRoute = (projectId: string, id: string) => `/v1/p/git/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(id)}`
