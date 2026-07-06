export type Me = { login: string; name: string; avatar: string; scopes: string[] }
export type Repo = {
  id: number
  owner: string
  name: string
  private: boolean
  defaultBranch: string | null
  pushedAt: number | null
}
export type Pull = {
  number: number
  title: string
  state: string
  draft: boolean
  author: string | null
  headRef: string | null
  baseRef: string | null
  updatedAt: number | null
  mergeable: string | null
  mergeStateStatus: string | null
  autoMergeEnabled: boolean
}

// Closed PRs are paginated on demand (one GitHub page per fetch); nextPage is null at the end.
export type ClosedPullsPage = { pulls: Pull[]; nextPage: number | null }

export type PullFile = {
  path: string
  status: string | null
  additions: number | null
  deletions: number | null
  sha: string | null
  viewed: boolean
  patch: string | null
}
export type PullFilesPatchRequest = { paths: string[] }
export type Review = { id: string; author: string | null; state: string | null; body: string | null; submittedAt: number | null }
export type Comment = { id: string; author: string | null; body: string | null; createdAt: number | null }
export type PullCommit = { sha: string; message: string; author: string | null; authorLogin: string | null; committedAt: number | null }
export type Check = { name: string; status: string | null; url: string | null; runId: number | null }
// A workflow run's jobs and their steps, for the checks side panel. Logs are a separate fetch.
export type WorkflowStep = { number: number; name: string; status: string | null; conclusion: string | null }
export type WorkflowJob = { id: number; name: string; status: string | null; conclusion: string | null; steps: WorkflowStep[] }
export type RunJobs = { jobs: WorkflowJob[] }
export type JobLog = { text: string }
export type Label = { name: string; color: string | null }
export type ThreadComment = { id: string; databaseId: number | null; author: string | null; body: string | null; createdAt: number | null }
export type Thread = {
  threadId: string
  path: string | null
  line: number | null
  side: string | null
  resolved: boolean
  comments: ThreadComment[]
}
export type PullDetail = {
  pull: (Pull & { number: number; body: string | null; headSha: string | null }) | null
  labels: Label[]
  reviews: Review[]
  requestedReviewers: string[]
  comments: Comment[]
  commits: PullCommit[]
  checks: Check[]
  threads: Thread[]
}
// One PR's full warmed payload, returned by the batch prefetch endpoint.
export type PullBatchItem = { number: number; detail: PullDetail; files: PullFile[] }
export type PullBatchFilesMode = 'full' | 'summary' | 'none'
export type PullBatchRequest = { numbers: number[]; files?: PullBatchFilesMode }

// Create-PR support: branch picker list + base..head compare (diff preview + commits for prefill).
export type Branch = { name: string }
export type CompareCommit = { sha: string; message: string }
export type Compare = { aheadBy: number; files: PullFile[]; commits: CompareCommit[] }

// Full head-blob body, fetched on demand to expand unchanged context around diff hunks.
export type FileBlob = { text: string }

// --- Integrations: multi-row per provider (docs/workspaces 04). GitHub appears as a synthesized
// entry (id 'github') so it reads as "just another integration", but it's the identity root — its
// token is the session cookie, not a stored row. ---
export type IntegrationProvider = 'github' | 'linear' | 'rollbar'
export type Integration = {
  id: string // 'github' for the synthesized entry; opaque uuid otherwise
  provider: IntegrationProvider
  label: string
  connected: boolean
  workspace?: string // provider-specific display hint (e.g. Linear org name), from meta
}
export type IntegrationsResponse = { integrations: Integration[] }
// Connect a provider by pasting a token; server validates + encrypts it, returns the new row.
export type ConnectIntegrationRequest = { provider: Exclude<IntegrationProvider, 'github'>; token: string }
export type LinearIssueState = { name: string; type: string; color: string } | null
export type LinearIssueSummary = { identifier: string; title: string; url: string; state: LinearIssueState; assignee: string | null }
export type LinearComment = { id: string; author: string | null; body: string; createdAt: number | null; parentId: string | null }
// One activity-feed entry. `icon` is a kind key (created|state|assignee|label|title) the client
// maps to a glyph; `color` tints state changes.
export type LinearActivity = { id: string; actor: string | null; text: string; createdAt: number | null; icon: string; color?: string }
export type LinearIssueDetail = LinearIssueSummary & { id: string; description: string | null; comments: LinearComment[]; activity: LinearActivity[] }
export type LinearCommentRequest = { body: string; parentId?: string }
export type LinearIssuesRequest = { identifiers: string[] }
export type LinearIssuesResponse = { issues: LinearIssueSummary[] }
// Linear projects + project-scoped issue browse (docs/workspaces — Linear source per repo). Each
// project carries which connection it came from, so the picker can span multiple Linear integrations.
export type LinearProject = { integrationId: string; integrationLabel: string; id: string; name: string }
export type LinearProjectsResponse = { projects: LinearProject[] }
export type LinearProjectIssue = LinearIssueSummary & { integrationId: string; branchName: string | null }
export type LinearProjectIssuesResponse = { issues: LinearProjectIssue[] }

// --- Rollbar (docs/integrations.md): deduped error items, cached into `issues` — zero new schema. ---
export type RollbarItem = {
  integrationId: string
  identifier: string // the visible item counter ('142')
  title: string
  level: string
  environment: string
  status: string
  totalOccurrences: number
  firstOccurrenceAt: number | null
  lastOccurrenceAt: number | null
}
export type RollbarItemsResponse = { items: RollbarItem[] }
export const rollbarItemsRoute = '/api/rollbar/items'
export const rollbarItemRoute = (integrationId: string, identifier: string) =>
  `/api/rollbar/items/${encodeURIComponent(identifier)}?integration=${encodeURIComponent(integrationId)}`
export const rollbarItemsKey = ['rollbar-items'] as const
export const rollbarItemKey = (integrationId: string, identifier: string) => ['rollbar-item', integrationId, identifier] as const

// --- Workspaces: named groups of repos (docs/workspaces). The top-level unit. ---
export type WorkspaceRepo = { owner: string; name: string; sort: number }
// When the worktree setup script runs: 'off' never, 'created' eagerly when the task is created,
// 'terminal' lazily when its terminal first opens (the default). null is treated as 'terminal'.
export type SetupTrigger = 'off' | 'created' | 'terminal'
// How the browser-preview pane resolves its URL: a fixed URL, http://localhost:<port>, or the
// stdout of a shell command run in the repo's worktree. null falls back to the dev-server port.
export type PreviewMode = 'url' | 'port' | 'script'
// Workspace identity (docs/workspaces-and-tasks.md): a small JSON-stored icon union (grows without migrations) and
// a colour (preset token key or 6-hex). null → derived defaults (name-hash colour, initial glyph).
export type WorkspaceIcon =
  | { kind: 'emoji'; value: string }
  | { kind: 'lucide'; value: string }
  | { kind: 'github' }
export type Workspace = {
  id: string
  name: string
  isDefault: boolean
  sort: number
  setupScript: string | null // shell command run once when a task worktree is created; null/blank = none
  setupScriptTrigger: SetupTrigger | null
  devScript: string | null // per-workspace "run dev" command surfaced as a `dev` run target; null/blank = none
  devRestartScript: string | null // per-workspace restart command for the `dev` target; null/blank = stop+start
  teardownScript: string | null // shell command run in the worktree just before removal (docs/terminal-and-agents.md); null/blank = none
  dbUrlScript: string | null // shell command run in the worktree to print a Postgres URL for the Database pane (docs/next/pg.md); null/blank = auto-detect
  previewMode: PreviewMode | null // how the browser-preview URL is resolved; null → dev-server port
  previewValue: string | null // the URL, port, or command per previewMode; null/blank = unset
  icon: WorkspaceIcon | null
  color: string | null
  repos: WorkspaceRepo[]
}
export type WorkspaceSeed = { name: string }
// Per-repo assignment for the onboarding modal: which workspace a repo is in + whether it's hidden.
export type RepoAssignment = { owner: string; name: string; workspaceId: string; ignored: boolean }

// --- Tasks: the single-repo unit of work (docs/workspaces/03). Rail rows. ---
// integrationId pins the link to a specific connection; provider is denormalized for filtering.
export type TaskLink = { integrationId: string; provider: string; identifier: string }
// A workspace's linked external projects (docs/workspaces 04) — (integrationId, externalId) pairs.
export type WorkspaceProject = { integrationId: string; externalId: string }
export type WorkspaceProjectsResponse = { projects: WorkspaceProject[] }
export type Task = {
  id: string
  title: string
  origin: 'github-pr' | 'linear' | 'rollbar' | 'local'
  repoOwner: string
  repoName: string
  branch: string
  worktreePath: string | null
  pullNumber: number | null
  status: 'active' | 'archived'
  parentId: string | null // task tree (docs/next 14 P4): fan-out children point at their root
  sort: number
  links: TaskLink[]
}
// The non-derived columns a new task needs, plus initial links. One create path for every
// Source (docs/workspaces/04). title is optional — the server seeds one from origin if absent.
export type TaskSeed = {
  title?: string
  origin: Task['origin']
  repoOwner: string
  repoName: string
  branch: string
  pullNumber?: number
  links?: TaskLink[]
}

// Assembled task context (docs/next 11 §C): everything attached to a task, composed once and
// consumed by both push (formatContextBlock → sendToAgent) and pull (MCP task_context).
export type TaskContextInclude = 'pr' | 'issues' | 'notes' | 'memory'
export type TaskContext = {
  task: { id: string; title: string; repo: string; branch: string; worktreePath: string | null; pullNumber: number | null }
  pr?: { number: number; title: string; body: string | null; changedFiles: string[] }
  issues: { provider: string; identifier: string; title: string; detail: string }[]
  notes: { slug?: string; title: string; body: string }[] // slug: client-only, lets the Context pane jump to the note in the Notes pane

  memory: { name: string; description: string }[]
}
export const taskContextRoute = (id: string, include?: TaskContextInclude[]) =>
  `/api/tasks/${id}/context${include?.length ? `?include=${include.join(',')}` : ''}`

// Local review notes (docs/panes.md): inline annotations on uncommitted changes, acorn-owned.
export type ReviewNote = {
  id: string
  taskId: string
  path: string
  side: 'additions' | 'deletions'
  startLine: number
  endLine: number
  snippet: string | null
  body: string
  sentAt: number | null // stamped on delivery; cleared on edit
  createdAt: number
}
export type ReviewNoteSeed = Pick<ReviewNote, 'path' | 'side' | 'startLine' | 'endLine' | 'body'> & { snippet?: string | null }

export const repoRoute = (owner: string, repo: string, child = '') => `/api/repos/${owner}/${repo}${child ? `/${child}` : ''}`
export const pullRoute = (owner: string, repo: string, number: string | number, child = '') =>
  repoRoute(owner, repo, `pulls/${number}${child ? `/${child}` : ''}`)

export const meRoute = '/api/me'
export const reposRoute = '/api/repos'
export const reposRefreshRoute = '/api/repos/refresh'
export const pullsRoute = (owner: string, repo: string, state: 'open' | 'closed') => `${repoRoute(owner, repo)}/pulls?state=${state}`
export const closedPullsRoute = (owner: string, repo: string, page: number) => `${pullsRoute(owner, repo, 'closed')}&page=${page}`
export const pullsBatchRoute = (owner: string, repo: string) => `${repoRoute(owner, repo)}/pulls/batch`
export const createPullRoute = (owner: string, repo: string) => `${repoRoute(owner, repo)}/pulls`
export const repoLabelsRoute = (owner: string, repo: string) => repoRoute(owner, repo, 'labels')
export const fileSummariesRoute = (owner: string, repo: string, number: string | number) => `${pullRoute(owner, repo, number, 'files')}?summary=1`
export const filePatchRoute = (owner: string, repo: string, number: string | number, path: string) =>
  `${pullRoute(owner, repo, number, 'files')}?path=${encodeURIComponent(path)}`
export const filePatchesRoute = (owner: string, repo: string, number: string | number) => pullRoute(owner, repo, number, 'files/patches')
export const branchesRoute = (owner: string, repo: string) => repoRoute(owner, repo, 'branches')
export const compareRoute = (owner: string, repo: string, base: string, head: string) =>
  `${repoRoute(owner, repo, 'compare')}?base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`
export const fileBlobRoute = (owner: string, repo: string, sha: string) => repoRoute(owner, repo, `blobs/${sha}`)
export const resolveThreadRoute = (owner: string, repo: string, number: string | number, threadId: string) =>
  pullRoute(owner, repo, number, `threads/${encodeURIComponent(threadId)}/resolve`)
export const autoMergeRoute = (owner: string, repo: string, number: string | number) => pullRoute(owner, repo, number, 'auto-merge')
export const rerunFailedRoute = (owner: string, repo: string, runId: number) => repoRoute(owner, repo, `actions/${runId}/rerun`)
export const runJobsRoute = (owner: string, repo: string, runId: number) => repoRoute(owner, repo, `actions/runs/${runId}/jobs`)
export const jobLogRoute = (owner: string, repo: string, jobId: number) => repoRoute(owner, repo, `actions/jobs/${jobId}/logs`)
export const mentionsRoute = (owner: string, repo: string) => repoRoute(owner, repo, 'mentions')
export const requestedReviewersRoute = (owner: string, repo: string, number: string | number) =>
  pullRoute(owner, repo, number, 'requested-reviewers')
export const pinsRoute = '/api/pins'
export const prefsRoute = '/api/prefs'
// Workspaces (named groups of repos) — the top-level unit.
export const workspacesRoute = '/api/workspaces'
export const workspaceRoute = (id: string) => `/api/workspaces/${id}`
export const workspaceBootstrapRoute = '/api/workspaces/bootstrap'
export const workspaceReposRoute = (id: string) => `/api/workspaces/${id}/repos`
export const workspaceIgnoreRepoRoute = '/api/workspaces/ignore-repo'
export const workspaceUnignoreRepoRoute = '/api/workspaces/unignore-repo'
export const workspaceIgnoreAllRoute = '/api/workspaces/ignore-all'
export const workspaceAssignmentsRoute = '/api/workspaces/assignments'
export const workspaceProjectsRoute = (id: string) => `/api/workspaces/${id}/projects`
// Tasks (single-repo units of work) — rail rows.
export const tasksRoute = '/api/tasks'
export const taskRoute = (id: string) => `/api/tasks/${id}`
export const taskLinksRoute = (id: string) => `/api/tasks/${id}/links`
export const reviewNotesRoute = (taskId: string) => `/api/tasks/${taskId}/review-notes`
export const reviewNoteRoute = (taskId: string, noteId: string) => `/api/tasks/${taskId}/review-notes/${noteId}`
export const reviewNotesSentRoute = (taskId: string) => `/api/tasks/${taskId}/review-notes/sent`
export const reviewNotesKey = (taskId: string) => ['review-notes', taskId] as const
export const integrationsRoute = '/api/integrations'
export const integrationRoute = (id: string) => `/api/integrations/${id}`
export const linearIssuesRoute = '/api/linear/issues'
export const linearProjectsRoute = '/api/linear/projects'
export const linearProjectIssuesRoute = (integrationId: string, projectIds: string[]) =>
  `/api/linear/project-issues?integration=${encodeURIComponent(integrationId)}&ids=${encodeURIComponent(projectIds.join(','))}`
export const linearIssueRoute = (identifier: string) => `/api/linear/issues/${encodeURIComponent(identifier)}?refresh=1`
export const linearCommentsRoute = (identifier: string) => `/api/linear/issues/${encodeURIComponent(identifier)}/comments`

export const meKey = ['me'] as const
export const reposKey = ['repos'] as const
export const pullsKey = (owner: string, repo: string, state: 'open' | 'closed') => ['pulls', owner, repo, state] as const
// Distinct from pullsKey(_, 'closed'): the closed list is now an infinite query ({pages}), so it must
// not share a key with the old finite-array cache entry (a persisted array would poison .data.pages).
export const closedPullsKey = (owner: string, repo: string) => ['pulls', owner, repo, 'closed', 'pages'] as const
export const pullsPrefixKey = (owner: string, repo: string) => ['pulls', owner, repo] as const
export const pullKey = (owner: string, repo: string, number: string) => ['pull', owner, repo, number] as const
export const pullPrefixKey = (owner: string, repo: string) => ['pull', owner, repo] as const
export const repoLabelsKey = (owner: string, repo: string) => ['labels', owner, repo] as const
export const filesKey = (owner: string, repo: string, number: string) => ['files', owner, repo, number] as const
export const fileSummariesKey = (owner: string, repo: string, number: string) => ['files', owner, repo, number, 'summary'] as const
export const filePatchKey = (owner: string, repo: string, number: string, path: string) => ['files', owner, repo, number, 'patch', path] as const
export const fileBlobKey = (owner: string, repo: string, sha: string) => ['blob', owner, repo, sha] as const
export const branchesKey = (owner: string, repo: string) => ['branches', owner, repo] as const
export const compareKey = (owner: string, repo: string, base: string, head: string) => ['compare', owner, repo, base, head] as const
export const pinsKey = ['pins'] as const
export const prefsKey = ['prefs'] as const
// 'groups' suffix: the bare ['workspaces'] key held the old single-tier task array, which may still
// be in a user's persisted IndexedDB cache — restoring it under a new shape (repos[]) would poison
// reads. A distinct key sidesteps the stale entry (same fix as closedPullsKey).
export const workspacesKey = ['workspaces', 'groups'] as const
export const workspaceAssignmentsKey = ['workspace-assignments'] as const
export const tasksKey = ['tasks'] as const
export const mentionsKey = (owner: string, repo: string) => ['mentions', owner, repo] as const
export const runJobsKey = (owner: string, repo: string, runId: number) => ['run-jobs', owner, repo, runId] as const
export const jobLogKey = (owner: string, repo: string, jobId: number) => ['job-log', owner, repo, jobId] as const
// 'v2' suffix: the bare ['integrations'] key held the old IntegrationsStatus shape ({ linear }),
// which may still be in a user's persisted IndexedDB cache — restoring it under the new shape
// ({ integrations: [] }) would poison reads (.integrations is undefined). Distinct key sidesteps the
// stale entry (same fix as workspacesKey/closedPullsKey).
export const integrationsKey = ['integrations', 'v2'] as const
export const linearIssuesKey = (identifiers: string[]) => ['linear-issues', ...[...identifiers].sort()] as const
export const linearProjectsKey = ['linear-projects'] as const
export const linearProjectIssuesKey = (integrationId: string, projectIds: string[]) =>
  ['linear-project-issues', integrationId, ...[...projectIds].sort()] as const
export const linearIssueKey = (identifier: string) => ['linear-issue', identifier] as const
