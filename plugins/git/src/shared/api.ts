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

export type Stash = {
  id: string; objectId: string; selector: string; fingerprint: string; message: string; originBranch: string | null;
  createdAt: number; base: string; untrackedParent: string | null; untrackedFiles: string[]
}
export type StashRoster = { projectId: string; repository: string; stashes: Stash[]; fingerprint: string }
export type StashSelection = Pick<Stash, 'objectId' | 'selector' | 'fingerprint'>
export type StashCreate = { taskId: string; expectedPath: string; message: string; includeUntracked: boolean; keepIndex: boolean }
export type StashApply = { taskId: string; expectedPath: string; selection: StashSelection; restoreIndex: boolean }
export type StashDrop = { selection: StashSelection; confirm: true }
export type StashResult = { ok: boolean; error: string | null; conflicts: string[] | null; roster: StashRoster | null; changed: boolean }
export const stashesRoute = (projectId: string) => `/v1/p/git/projects/${encodeURIComponent(projectId)}/stashes`

export type ExplainKind = 'commit' | 'stash'
export type ExplainRequest = { backendId: string; modelId: string; base: string | null }
export type ExplainResult = { text: string; backendId: string; modelId: string; omissions: string[] }
export const explainRoute = (projectId: string, kind: ExplainKind, id: string) =>
  `/v1/p/git/projects/${encodeURIComponent(projectId)}/explanations/${kind}/${encodeURIComponent(id)}`

export type GitRef = { name: string; kind: 'local' | 'remote' | 'tag'; objectId: string; commitId: string | null; upstream: string | null; checkedOut: boolean; reservedBy: WorktreeOwner[] }
export type RefRoster = { repository: string; refs: GitRef[] }
export type RefChange =
  | { action: 'create-branch'; name: string; startId: string }
  | { action: 'rename-branch'; name: string; expectedId: string; nextName: string }
  | { action: 'delete-branch'; name: string; expectedId: string }
  | { action: 'set-upstream'; name: string; expectedId: string; upstream: string | null }
  | { action: 'create-tag'; name: string; startId: string; message: string | null }
  | { action: 'delete-tag'; name: string; expectedId: string }
export type RefChangeResult = { ok: boolean; reason: string | null; roster: RefRoster }
export const refsRoute = (projectId: string) => `/v1/p/git/projects/${encodeURIComponent(projectId)}/refs`

export type GitRemote = { name: string; fetchUrl: string; pushUrl: string; fetchUrlCount: number; pushUrlCount: number }
export type RemoteRoster = { repository: string; remotes: GitRemote[]; lastFetch: Record<string, { successAt: number | null; failureAt: number | null; error: string | null }> }
export type RemoteChange =
  | { action: 'add'; name: string; url: string }
  | { action: 'remove'; name: string; expectedUrl: string }
  | { action: 'set-url'; name: string; expectedUrl: string; url: string }
  | { action: 'fetch'; name: string; expectedUrl: string }
export type RemoteChangeResult = { ok: boolean; reason: string | null; roster: RemoteRoster }
export const remotesRoute = (projectId: string) => `/v1/p/git/projects/${encodeURIComponent(projectId)}/remotes`

export type ComparisonMode = 'direct' | 'merge-base'
export type Comparison = { source: string; destination: string; base: string; mode: ComparisonMode }
export const comparisonRoute = (projectId: string) => `/v1/p/git/projects/${encodeURIComponent(projectId)}/comparison`

export type IdentityValue = { value: string | null; scope: string | null; origin: string | null; local: string | null; global: string | null }
export type GitSettings = { repository: string; name: IdentityValue; email: IdentityValue; pullPolicy: 'ff-only' | 'rebase'; autoFetch: boolean }
export type IdentityWrite = { scope: 'local' | 'global'; name: string; email: string }
export type IdentityWriteResult = { name: { ok: boolean; error: string | null }; email: { ok: boolean; error: string | null }; settings: GitSettings; readbackError: string | null }
export const gitSettingsRoute = (projectId: string) => `/v1/p/git/projects/${encodeURIComponent(projectId)}/settings`
