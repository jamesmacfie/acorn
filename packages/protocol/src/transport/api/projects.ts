import type { ExternalRef } from '../../integrations/providers.ts'
import type { McpServerSummary } from '../../integrations/mcp.ts'

// Workspaces group projects and are the top-level unit (docs/workspaces-and-tasks.md).
// When the worktree setup script runs: 'off' never, 'created' when the task is created, 'terminal'
// when its terminal first opens (the default). null means 'terminal'.
export type SetupTrigger = 'off' | 'created' | 'terminal'
// How the browser-preview pane resolves its URL: a fixed URL, http://localhost:<port>, or the
// stdout of a shell command run in the repo's worktree. null falls back to the dev-server port.
export type PreviewMode = 'url' | 'port' | 'script'
// Where the Database pane's AI-generation schema text comes from: live introspection of the
// connected Postgres, the stdout of a shell command, or a file in the worktree. null → 'auto'.
export type DbSchemaMode = 'auto' | 'script' | 'file'
// Preview-browser page rules (docs/panes.md), applied by the main process when a preview page loads.
// Discriminated unions so future triggers and actions extend without a schema change. Stored as one
// JSON column on workspaces.
export type BrowserRuleAction = { type: 'fill'; selector: string; value: string }
export type BrowserRule = {
  id: string
  enabled: boolean
  urlPattern: string // substring match against the page URL; '*' = wildcard
  trigger: 'load'
  action: BrowserRuleAction
}
export type Workspace = {
  id: string
  name: string
  isDefault: boolean
  sort: number
  projects: WorkspaceProjectRef[]
}
export type WorkspaceSeed = { name: string }

// A project is a folder on the node's machine, the unit a workspace groups
// (docs/workspaces-and-tasks.md). The successor to (owner, name) repo keying. `vcs` and `github` are
// detected facets, not requirements: a plain folder has neither, a git checkout without a GitHub
// remote has only `vcs`, and `path` is null for a project imported from GitHub but not yet cloned.
export type Project = {
  id: string
  name: string
  path: string | null
  workspaceId: string
  sort: number
  hidden: boolean
  // Optional owner-selected accent for this project's task tabs. null means no project accent.
  color: string | null
  vcs: 'git' | null
  defaultBranch: string | null
  remoteUrl: string | null
  github: { owner: string; name: string; repoId: number | null } | null
}
export type ProjectSeed = { path: string; workspaceId?: string; name?: string }
export type ProjectPatch = Partial<{ name: string; workspaceId: string; hidden: boolean; color: string | null; sort: number; path: string }>
export type ProjectsResponse = { projects: Project[] }
export type WorkspaceProjectRef = { id: string; name: string; sort: number }
export type ProjectConfig = {
  runTargets: string | null
  editorCommand: string | null
  setupScript: string | null
  setupScriptTrigger: SetupTrigger | null
  devScript: string | null
  devRestartScript: string | null
  teardownScript: string | null
  dbUrlScript: string | null
  dbSchemaMode: DbSchemaMode | null
  dbSchemaValue: string | null
  dbSchemaNotes: string | null
  previewMode: PreviewMode | null
  previewValue: string | null
  browserRules: BrowserRule[]
  branchPrefix: string | null
}
export type ProjectConfigPatch = Partial<{
  setupScript: string
  setupScriptTrigger: SetupTrigger
  teardownScript: string
  devScript: string
  devRestartScript: string
  dbUrlScript: string
  dbSchemaMode: DbSchemaMode | ''
  dbSchemaValue: string
  dbSchemaNotes: string
  previewMode: PreviewMode | ''
  previewValue: string
  browserRules: BrowserRule[]
  branchPrefix: string
}>
// What the project checkout's committed `.acorn/config.toml` sets, which wins over the matching
// machine-local value in `config` (docs/workspaces-and-tasks/project-config.md § The project row). A key is
// present only when the file sets it. Run targets merge by id, so each one here replaces the machine
// target with the same id and leaves the others in place, and a `dev` target replaces the dev script
// and its restart command too. Whether the file is trusted yet decides whether a task may run it, not
// which value wins, so this is reported either way.
export type ProjectRepoConfig = {
  runTargets: ProjectRunTarget[]
  dbUrlScript?: string
  previewMode?: PreviewMode
  previewValue?: string
}
// One run target as `.acorn/config.toml` and the `runTargets` JSON declare it.
export type ProjectRunTarget = {
  id: string
  command: string
  stop?: string
  restart?: string
  url?: string
  urlCommand?: string
  icon?: string
  default?: boolean
}
// `repoConfig` is only on the config read, and only when the project has a folder on disk. An older
// node never sends it, which a client reads as "nothing set by the repo".
export type ProjectConfigResponse = { projectId: string; config: ProjectConfig; repoConfig?: ProjectRepoConfig }

// Tasks are the project-level units of work and appear as rail rows (docs/workspaces-and-tasks.md).
// connectionId pins the link to a specific credential. providerId is stamped by core from that row.
export type TaskLink = { connectionId: string; providerId: string; identifier: string; ref?: ExternalRef }
export type TaskLinkSeed = { connectionId: string; identifier: string; ref?: Omit<ExternalRef, 'providerId' | 'connectionId'>; providerId?: string }
// A workspace's linked provider projects (docs/workspaces-and-tasks.md): (integrationId, externalId)
// pairs. `projectId` narrows the link to one project in that workspace; leave it off and the link
// covers every project there.
export type WorkspaceExternalProject = { integrationId: string; externalId: string; projectId?: string }
export type WorkspaceExternalProjectsResponse = { projects: WorkspaceExternalProject[] }

// A Lucide icon name (see client-core/kit/components/content/Icon.tsx). Shape-check it here because
// the icon map belongs to the client. An unrecognized name falls back to rendering as text.
export const ICON_NAME_RE = /^[a-z0-9-]{1,40}$/

export type Task = {
  id: string
  title: string
  icon: string | null // Lucide icon name; null = derive from origin
  origin: string
  projectId: string
  branch: string | null
  github: { owner: string; name: string } | null
  worktreePath: string | null
  pullNumber: number | null
  status: 'active' | 'archived' | 'cancelled'
  parentId: string | null // task tree (docs/workspaces-and-tasks.md): delegated and nested-workflow tasks point at their creating task
  sort: number
  links: TaskLink[]
}
// A row of `GET tasksRoute?status=archived`, the archive page's list.
export type ArchivedTask = Task & { archivedAt: number }
// The non-derived columns a new task needs, plus initial links. One create path for every source
// (docs/workspaces-and-tasks.md). `title` is optional; the server seeds one from origin.
export type TaskSeed = {
  title?: string
  icon?: string
  origin: Task['origin']
  projectId: string
  branch?: string
  branchSource?: 'derived' | 'exact'
  baseBranch?: string
  // An existing linked worktree from projectWorktreesRoute. The node checks it against git and
  // takes the branch from it, so `branch` is ignored when this is set.
  worktreePath?: string
  skipSetup?: boolean
  pullNumber?: number
  links?: TaskLinkSeed[]
}

export type RepoConfigTrustReview = {
  taskId: string
  projectId: string | null
  trusted: boolean
  current: { hash: string; text: string; files: Array<{ path: string; content: string }> } | null
  previous: { hash: string; text: string; ackedAt: number } | null
}
export const repoConfigTrustRoute = (taskId: string) => `/v1/core/tasks/${taskId}/config-trust`

export const taskStatusesRoute = '/v1/core/task-statuses'
export const projectsRoute = '/v1/core/projects'
export const projectRoute = (id: string) => `${projectsRoute}/${encodeURIComponent(id)}`
export const projectDetectRoute = (id: string) => `${projectRoute(id)}/detect`
export const projectConfigRoute = (id: string) => `${projectRoute(id)}/config`
export const projectRunTargetsRoute = (id: string) => `${projectRoute(id)}/run-targets`
// Linked git worktrees of the project's checkout that no active task uses yet, for the new-task
// dialog's "Existing worktree" tab.
export const projectWorktreesRoute = (id: string) => `${projectRoute(id)}/worktrees`
export type ProjectWorktree = { path: string; branch: string }
export const projectBranchesRoute = (id: string) => `${projectRoute(id)}/branches`
export type ProjectBranches = {
  current: string | null
  tasks: Array<{ branch: string; taskId: string; title: string }>
  other: Array<{ name: string; committedAt: number }>
}
export const projectWorktreeAvailabilityRoute = (id: string, branch: string, options?: { branchSource?: 'derived' | 'exact'; baseBranch?: string }) =>
  `${projectRoute(id)}/worktree-availability?branch=${encodeURIComponent(branch)}${options?.branchSource ? `&branchSource=${options.branchSource}` : ''}${options?.baseBranch ? `&baseBranch=${encodeURIComponent(options.baseBranch)}` : ''}`
export type WorktreeAvailability = ({ available: true } | { available: false; reason: string }) & { branch?: string }
// The MCP config files the agents in this project load, and the empty .mcp.json Settings can seed
// (docs/mcp.md § Configuration).
export const projectMcpRoute = (id: string) => `${projectRoute(id)}/mcp`
export const projectMcpStarterRoute = (id: string) => `${projectRoute(id)}/mcp/starter`
export type ProjectMcpFile = { file: string; servers: McpServerSummary[] }
export const taskArchiveRoute = (id: string) => `/v1/core/tasks/${id}/archive`
export const taskRestoreRoute = (id: string) => `/v1/core/tasks/${id}/restore`
// What every plugin has to say about archiving this task, asked once when the dialog opens
// (node-core/server/pluginHost/taskChecks.ts).
export const taskArchiveConcernsRoute = (id: string) => `/v1/core/tasks/${id}/archive-concerns`
export const taskPreviewUrlRoute = (id: string) => `/v1/core/tasks/${id}/preview-url`
export const taskOnCreatedRoute = (id: string) => `/v1/core/tasks/${id}/on-created`

// Workspaces (named groups of Projects): the top-level unit.
export const workspacesRoute = '/v1/core/workspaces'
export const workspaceRoute = (id: string) => `/v1/core/workspaces/${id}`
export const workspaceBootstrapRoute = '/v1/core/workspaces/bootstrap'
export const workspaceExternalProjectsRoute = (id: string) => `/v1/core/workspaces/${id}/external-projects`
// Tasks (Project -> Task units of work): rail rows.
export const tasksRoute = '/v1/core/tasks'
export const archivedTasksRoute = `${tasksRoute}?status=archived`
export const taskRoute = (id: string) => `/v1/core/tasks/${id}`
export const taskLinksRoute = (id: string) => `/v1/core/tasks/${id}/links`

// The suffixes identify the current response shapes and stop unrelated query data sharing keys.
export const workspacesKey = ['workspaces', 'groups', 'v2'] as const
// The `v2` suffix identifies the current task response shape, including its required `icon` field.
export const projectsKey = ['projects', 'v2'] as const
// v3 removes the legacy repo pair and makes projectId/github/nullable branch explicit.
export const tasksKey = ['tasks', 'v3'] as const
