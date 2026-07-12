import type { NoteLocation } from './notes'
import type {
  ExternalRef,
  IntegrationAuthKind,
  IntegrationConnectionStatus,
  ProviderAccountRef,
  ProviderErrorCode,
  PublicIntegrationProvider,
} from './integrations'

// The one error envelope every /api route returns. `error` is a stable machine code
// (see docs/api-reference.md §error-codes); `detail` carries human/upstream prose.
export type ApiError = { error: string; detail?: string[] }
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

// --- Integrations: multi-row per provider (docs/workspaces-and-tasks.md). GitHub appears as a synthesized
// entry (id 'github') so it reads as "just another integration", but it's the identity root — its
// token is the session cookie, not a stored row. ---
export type IntegrationProvider = string
export type Integration = {
  id: string // 'github' for the synthesized entry; opaque uuid otherwise
  providerId: IntegrationProvider
  label: string
  status: IntegrationConnectionStatus
  authKind: IntegrationAuthKind
  account: ProviderAccountRef | null
  scopes: string[]
  capabilities: Record<string, 'available' | 'missing-scope' | 'degraded'>
  createdAt: number
  updatedAt: number
  lastValidatedAt?: number
  lastError?: ProviderErrorCode
}
export type IntegrationsResponse = { providers: PublicIntegrationProvider[]; integrations: Integration[] }
// Credential values are write-only: the response contains only the normalized connection summary.
export type ConnectIntegrationRequest = { providerId: IntegrationProvider; credentials: Record<string, string> }
export type RotateIntegrationRequest = { credentials: Record<string, string> }
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
// Linear projects + project-scoped issue browse (docs/workspaces-and-tasks.md — Linear source per repo). Each
// project carries which connection it came from, so the picker can span multiple Linear integrations.
export type LinearProject = { integrationId: string; integrationLabel: string; id: string; name: string }
export type LinearProjectsResponse = { projects: LinearProject[] }
export type LinearProjectIssue = LinearIssueSummary & { integrationId: string; branchName: string | null }
export type LinearProjectIssuesResponse = { issues: LinearProjectIssue[] }

// --- Rollbar (docs/integrations.md): deduped error items mirrored into `issues`. ---
// The list row (summary) and the detail differ: detail adds a normalized, privacy-safe view of the
// latest occurrence. Raw upstream occurrence JSON never crosses this boundary (see docs/security.md).
export type RollbarItemSummary = {
  integrationId: string
  integrationLabel: string
  identifier: string // the project-visible counter ('142')
  itemId: string // system-wide item id, a string at Acorn boundaries ('' when a legacy row predates it)
  url: string | null // Rollbar's account-independent item permalink
  title: string
  level: string
  environment: string
  status: string
  totalOccurrences: number
  firstOccurrenceAt: number | null
  lastOccurrenceAt: number | null
  framework?: string
}

export type RollbarStackFrame = {
  filename: string
  line: number | null
  column: number | null
  method: string | null
  code: Array<{ line: number; text: string }>
  inProject: boolean | null
}

export type RollbarOccurrenceDetail = {
  id: string
  occurredAt: number | null
  uuid: string | null
  url: string | null // UUID redirect; null only when an upstream occurrence omitted its UUID
  kind: 'trace' | 'trace-chain' | 'message' | 'crash-report' | 'unknown'
  exceptionClass: string | null
  message: string | null
  frames: RollbarStackFrame[]
  request: { method: string | null; url: string | null } | null
  context: string | null
  codeVersion: string | null
  platform: string | null
  language: string | null
  framework: string | null
  server: { host: string | null; branch: string | null } | null
  person: { id: string | null; username: string | null; email: string | null } | null
  notifier: { name: string | null; version: string | null } | null
  truncated: boolean
}

export type RollbarItemMetadata = RollbarItemSummary & {
  resolvedInVersion: string | null
  assignedTo: string | null
}

export type RollbarOccurrenceSummary = Pick<
  RollbarOccurrenceDetail,
  'id' | 'occurredAt' | 'uuid' | 'url' | 'kind' | 'exceptionClass' | 'message'
>

export type RollbarOccurrencesResponse = {
  occurrences: RollbarOccurrenceSummary[]
  capped: boolean
}

// Compatibility composite for the public automation API. The desktop pane uses the independently
// cached metadata / occurrence-list / occurrence-detail routes below so inactive tabs do no work.
export type RollbarItemDetail = RollbarItemMetadata & {
  latestOccurrence: RollbarOccurrenceDetail | null
}

// List responses admit partial success: a connection can fail or return the capped set while others
// succeed. The UI must not turn a transport/auth failure into "no active items".
export type RollbarItemsResponse = {
  items: RollbarItemSummary[]
  failures: Array<{ integrationId: string; code: string }>
  cappedIntegrationIds: string[]
}
export const rollbarItemsRoute = '/api/rollbar/items'
export const rollbarItemsForConnectionsRoute = (integrationIds: readonly string[]) =>
  `${rollbarItemsRoute}?integrations=${encodeURIComponent([...new Set(integrationIds)].sort().join(','))}`
export const rollbarItemRoute = (integrationId: string, identifier: string, refresh = false) =>
  `/api/rollbar/items/${encodeURIComponent(identifier)}?integration=${encodeURIComponent(integrationId)}${refresh ? '&refresh=true' : ''}`
export const rollbarItemMetadataRoute = (integrationId: string, identifier: string, refresh = false) =>
  `/api/rollbar/items/${encodeURIComponent(identifier)}/detail?integration=${encodeURIComponent(integrationId)}${refresh ? '&refresh=true' : ''}`
export const rollbarOccurrencesRoute = (integrationId: string, identifier: string, refresh = false) =>
  `/api/rollbar/items/${encodeURIComponent(identifier)}/occurrences?integration=${encodeURIComponent(integrationId)}${refresh ? '&refresh=true' : ''}`
export const rollbarOccurrenceRoute = (integrationId: string, identifier: string, occurrenceId: string, refresh = false) =>
  `/api/rollbar/items/${encodeURIComponent(identifier)}/occurrences/${encodeURIComponent(occurrenceId)}?integration=${encodeURIComponent(integrationId)}${refresh ? '&refresh=true' : ''}`
export const rollbarItemsKey = (integrationIds: readonly string[]) =>
  ['rollbar-items', 'connections', ...[...new Set(integrationIds)].sort()] as const
export const rollbarItemKey = (integrationId: string, identifier: string) => ['rollbar-item', integrationId, identifier] as const
export const rollbarItemMetadataKey = (integrationId: string, identifier: string) => ['rollbar-item-metadata', integrationId, identifier] as const
export const rollbarOccurrencesKey = (integrationId: string, identifier: string) => ['rollbar-occurrences', integrationId, identifier] as const
export const rollbarOccurrenceKey = (integrationId: string, identifier: string, occurrenceId: string) =>
  ['rollbar-occurrence', integrationId, identifier, occurrenceId] as const

// --- Workspaces: named groups of repos (docs/workspaces-and-tasks.md). The top-level unit. ---
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
  dbUrlScript: string | null // shell command run in the worktree to print a Postgres URL for the Database pane (docs/pg.md); null/blank = auto-detect
  previewMode: PreviewMode | null // how the browser-preview URL is resolved; null → dev-server port
  previewValue: string | null // the URL, port, or command per previewMode; null/blank = unset
  icon: WorkspaceIcon | null
  color: string | null
  repos: WorkspaceRepo[]
}
export type WorkspaceSeed = { name: string }
// Per-repo assignment for the onboarding modal: which workspace a repo is in + whether it's hidden.
export type RepoAssignment = { owner: string; name: string; workspaceId: string; ignored: boolean }

// --- Tasks: the single-repo unit of work (docs/workspaces-and-tasks.md/03). Rail rows. ---
// connectionId pins the link to a specific credential. providerId is stamped by core from that row.
export type TaskLink = { connectionId: string; providerId: string; identifier: string; ref?: ExternalRef }
export type TaskLinkSeed = { connectionId: string; identifier: string; ref?: Omit<ExternalRef, 'providerId' | 'connectionId'>; providerId?: string }
// A workspace's linked external projects (docs/workspaces-and-tasks.md) — (integrationId, externalId) pairs.
export type WorkspaceProject = { integrationId: string; externalId: string }
export type WorkspaceProjectsResponse = { projects: WorkspaceProject[] }
export type Task = {
  id: string
  title: string
  origin: string
  repoOwner: string
  repoName: string
  branch: string
  worktreePath: string | null
  pullNumber: number | null
  status: 'active' | 'archived' | 'cancelled'
  parentId: string | null // task tree (docs/workflows.md): fan-out children point at their root
  sort: number
  links: TaskLink[]
}
// The non-derived columns a new task needs, plus initial links. One create path for every
// Source (docs/workspaces-and-tasks.md/04). title is optional — the server seeds one from origin if absent.
export type TaskSeed = {
  title?: string
  origin: Task['origin']
  repoOwner: string
  repoName: string
  branch: string
  pullNumber?: number
  links?: TaskLinkSeed[]
}

// Assembled task context (docs/agent-tools.md §4): section contributions serialize their renderer
// metadata and compact projection beside the compatibility fields used by focused tools.
export type TaskContextInclude = string
export type ContextBudget = {
  maxItems?: number
  maxBytesPerItem?: number
  overflow: 'truncate-tail' | 'index-only' | 'omit-with-marker'
}
export type ContextPaneIntent = {
  pane: string
  itemId?: string
  noteScope?: 'global' | 'workspace' | 'task'
  ref?: ExternalRef
}
export type ContextItem = {
  id: string
  kind: string
  label: string
  body?: string
  details?: string[]
  jump?: ContextPaneIntent
  origin?: { author: 'user' | 'agent' | 'workflow' } // notes section only, for provenance badges
}
export type ContextSectionResult = {
  id: string
  label: string
  defaultIncluded: boolean
  budget: ContextBudget
  items: ContextItem[]
  compact: string
  omitted: number
  absent?: { reason: 'missing-cache'; detail: string }
}
export type TaskContext = {
  task: { id: string; title: string; repo: string; branch: string; worktreePath: string | null; pullNumber: number | null }
  sections: ContextSectionResult[]
  pr?: { number: number; title: string; body: string | null; changedFiles: string[] }
  issues: { provider: string; identifier: string; title: string; detail: string; cache: 'present' | 'missing' }[]
  notes: { slug?: string; scope?: 'global' | 'workspace' | 'task'; title: string; body: string }[]

  memory: { name: string; description: string }[]
}
export const taskContextRoute = (id: string, include?: TaskContextInclude[] | 'all') =>
  `/api/tasks/${id}/context${include === 'all' ? '?include=*' : include?.length ? `?include=${include.join(',')}` : ''}`

// Agent tools (docs/agent-tools.md): the registry projects to the harness HTTP surface below and to
// the MCP server. The permissions page reads the static catalog and persists per-tier/per-tool
// toggles as ONE prefs slice under this key (JSON `{ tiers?, tools? }`).
export type ToolRisk = 'read' | 'write' | 'execute'
export const AGENT_TOOLS_PERMS_PREF_KEY = 'agentTools.perms'
export const agentToolsCatalogRoute = '/api/agent-tools'
export type AgentToolCatalogEntry = { name: string; description: string; risk: ToolRisk; availability?: string }
export const rendererAgentToolRoute = (taskId: string, name: string) => `/api/tasks/${taskId}/renderer-tools/${encodeURIComponent(name)}`

// Find-in-files (docs/panes.md): POST because it spawns ripgrep and the query is arbitrary body,
// not a path segment. Was the `search:findInFiles` IPC channel.
export const searchRoute = (taskId: string) => `/api/tasks/${taskId}/search`

// Editor pane (docs/workspaces-and-tasks.md): read/write/list worktree files. Was the `editor:*` IPC channels.
// relPath rides a query param so a nested path never collides with the route segments.
export type EditorEntry = { name: string; dir: boolean }
export type EditorWriteResult = { ok: boolean; reason?: string }
export const editorRootRoute = (taskId: string) => `/api/tasks/${taskId}/editor/root`
export const editorFilesRoute = (taskId: string) => `/api/tasks/${taskId}/editor/files`
export const editorListRoute = (taskId: string, relPath: string) => `/api/tasks/${taskId}/editor/list?path=${encodeURIComponent(relPath)}`
export const editorReadRoute = (taskId: string, relPath: string) => `/api/tasks/${taskId}/editor/read?path=${encodeURIComponent(relPath)}`
export const editorWriteRoute = (taskId: string) => `/api/tasks/${taskId}/editor/file`

// Run targets (docs/workflows.md §2): the renderer shares the RunBridge routes the MCP run tools use
// (server/routes/harness.ts). Was the `run:*` IPC channels.
export const runTargetsRoute = (taskId: string) => `/api/tasks/${taskId}/run`
export const runDefaultUrlRoute = (taskId: string) => `/api/tasks/${taskId}/run/default-url`
export const runStartRoute = (taskId: string, targetId: string) => `/api/tasks/${taskId}/run/${encodeURIComponent(targetId)}/start`
export const runStopRoute = (taskId: string, targetId: string) => `/api/tasks/${taskId}/run/${encodeURIComponent(targetId)}/stop`
export const runStatusRoute = (taskId: string, targetId: string) => `/api/tasks/${taskId}/run/${encodeURIComponent(targetId)}/status`

export type RepoConfigTrustReview = {
  taskId: string
  repo: string | null
  trusted: boolean
  current: { hash: string; text: string; files: Array<{ path: string; content: string }> } | null
  previous: { hash: string; text: string; ackedAt: number } | null
}
export const repoConfigTrustRoute = (taskId: string) => `/api/tasks/${taskId}/config-trust`

// Workflow control (docs/workflows.md): task-scoped defs/start/runs and run-scoped steps/gates.
// Commands use HTTP; workflow notices and step events use the shared WebSocket.
export const workflowDefsRoute = (taskId: string) => `/api/tasks/${taskId}/workflows`
export const workflowStartRoute = (taskId: string) => `/api/tasks/${taskId}/workflows`
export const workflowRunsRoute = (taskId: string) => `/api/tasks/${taskId}/workflows/runs`
export const workflowStepsRoute = (runId: string) => `/api/workflows/runs/${runId}/steps`
export const workflowGateRoute = (runId: string) => `/api/workflows/runs/${runId}/gate`
export const workflowCancelRoute = (runId: string) => `/api/workflows/runs/${runId}/cancel`
export const workflowKillRoute = (runId: string) => `/api/workflows/runs/${runId}/kill`
export const workflowTriggerPollRoute = '/api/workflows/triggers/poll'

// Local-changes review (docs/panes.md): working-tree status/diff/blob + stage/commit/discard/push.
// Was the `local:*` IPC channels.
export const localChangesRoute = (taskId: string) => `/api/tasks/${taskId}/local/changes`
export const localDiffRoute = (taskId: string, path: string, scope: 'unstaged' | 'staged') =>
  `/api/tasks/${taskId}/local/diff?path=${encodeURIComponent(path)}&scope=${scope}`
export const localBlobRoute = (taskId: string, path: string, ref?: string) =>
  `/api/tasks/${taskId}/local/blob?path=${encodeURIComponent(path)}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`
export const localActionRoute = (taskId: string, action: 'stage' | 'unstage' | 'discard' | 'commit' | 'stage-all' | 'unstage-all' | 'discard-all' | 'push') =>
  `/api/tasks/${taskId}/local/${action}`

// Database pane (docs/pg.md): per-task Postgres browse/edit. Was the `db:*` IPC channels.
export const databaseTablesRoute = (taskId: string) => `/api/tasks/${taskId}/database/tables`
export const databaseColumnsRoute = (taskId: string, schema: string, name: string) =>
  `/api/tasks/${taskId}/database/columns?schema=${encodeURIComponent(schema)}&name=${encodeURIComponent(name)}`
export const databaseRowsRoute = (taskId: string, schema: string, name: string, offset?: number) =>
  `/api/tasks/${taskId}/database/rows?schema=${encodeURIComponent(schema)}&name=${encodeURIComponent(name)}${offset ? `&offset=${offset}` : ''}`
export const databaseActionRoute = (taskId: string, action: 'connect' | 'disconnect' | 'query' | 'update' | 'insert' | 'delete') =>
  `/api/tasks/${taskId}/database/${action}`

// Notes + memory pane (docs/notes-and-memory.md). These routes replaced the old feature-specific IPC surface.
export const memoryListRoute = (repo?: string) => `/api/memory${repo ? `?repo=${encodeURIComponent(repo)}` : ''}`
export const memorySearchRoute = (query: string, repo?: string, type?: string) =>
  `/api/memory/search?q=${encodeURIComponent(query)}${repo ? `&repo=${encodeURIComponent(repo)}` : ''}${type ? `&type=${encodeURIComponent(type)}` : ''}`
export const memoryAddRoute = (taskId: string) => `/api/tasks/${taskId}/memory`
export const memoryProposalsRoute = (taskId?: string) => `/api/memory/proposals${taskId ? `?task=${encodeURIComponent(taskId)}` : ''}`
export const memoryResolveProposalRoute = (id: string) => `/api/memory/proposals/${encodeURIComponent(id)}/resolve`
// Existing workspace/global URLs stay stable; task scope adds its reserved subtree without moving
// persisted files. `global` remains the reserved workspace-key URL for compatibility.
export const notesListRoute = (location: NoteLocation) =>
  location.scope === 'task'
    ? `/api/tasks/${encodeURIComponent(location.taskId)}/notes`
    : `/api/workspaces/${encodeURIComponent(location.scope === 'global' ? 'global' : location.workspaceId)}/notes`
export const noteRoute = (location: NoteLocation, slug: string) => `${notesListRoute(location)}/${encodeURIComponent(slug)}`
export const noteIncludedRoute = (location: NoteLocation, slug: string) => `${noteRoute(location, slug)}/included`
export const noteTitleRoute = (location: NoteLocation, slug: string) => `${noteRoute(location, slug)}/title`

// Terminal control (docs/terminal-and-agents.md): request/response routes for the main-process
// engine. Input/output/status use the WebSocket; only the native folder picker stays on preload IPC.
export const terminalSessionsRoute = '/api/terminal/sessions'
export const terminalProfilesRoute = '/api/terminal/profiles'
export const terminalTaskStatusesRoute = '/api/terminal/task-statuses'
export const terminalSessionActionRoute = (sid: string, action: 'kill' | 'interrupt' | 'remove' | 'resize' | 'send') =>
  `/api/terminal/sessions/${encodeURIComponent(sid)}/${action}`
export const terminalRepoPathRoute = (owner: string, repo: string) =>
  `/api/terminal/repo-path?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`
export const terminalRepoPathSetRoute = '/api/terminal/repo-path'
export const terminalRepoPathRunTargetsRoute = '/api/terminal/repo-path/run-targets'
export const taskArchiveRoute = (id: string) => `/api/tasks/${id}/archive`
export const taskPreviewUrlRoute = (id: string) => `/api/tasks/${id}/preview-url`
export const taskOnCreatedRoute = (id: string) => `/api/tasks/${id}/on-created`
export const taskUseCheckoutRoute = (id: string) => `/api/tasks/${id}/use-checkout`
export const taskMcpRoute = (id: string) => `/api/tasks/${id}/mcp`
export const taskMcpStarterRoute = (id: string) => `/api/tasks/${id}/mcp/starter`

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
export const integrationTestRoute = (id: string) => `/api/integrations/${id}/test`
export const linearIssuesRoute = '/api/linear/issues'
export const linearProjectsRoute = '/api/linear/projects'
export const linearProjectIssuesRoute = (integrationId: string, projectIds: string[]) =>
  `/api/linear/project-issues?integration=${encodeURIComponent(integrationId)}&ids=${encodeURIComponent(projectIds.join(','))}`
const connectionQuery = (connectionId?: string) => (connectionId ? `&integration=${encodeURIComponent(connectionId)}` : '')
export const linearIssueRoute = (identifier: string, connectionId?: string) =>
  `/api/linear/issues/${encodeURIComponent(identifier)}?refresh=1${connectionQuery(connectionId)}`
export const linearCommentsRoute = (identifier: string, connectionId?: string) =>
  `/api/linear/issues/${encodeURIComponent(identifier)}/comments${connectionId ? `?integration=${encodeURIComponent(connectionId)}` : ''}`

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
// v3 adds descriptor metadata and normalized connection summaries. A distinct key prevents a
// persisted v2 `{ provider, connected }` row from hiding registry-driven sources/settings.
export const integrationsKey = ['integrations', 'v3'] as const
export const linearIssuesKey = (identifiers: string[]) => ['linear-issues', ...[...identifiers].sort()] as const
export const linearProjectsKey = ['linear-projects'] as const
export const linearProjectIssuesKey = (integrationId: string, projectIds: string[]) =>
  ['linear-project-issues', integrationId, ...[...projectIds].sort()] as const
export const linearIssueKey = (identifier: string, connectionId?: string) =>
  ['linear-issue', connectionId ?? 'unscoped', identifier] as const
