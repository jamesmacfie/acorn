import type {
  ExternalRef,
  IntegrationAuthKind,
  IntegrationConnectionStatus,
  ProviderAccountRef,
  ProviderErrorCode,
  PublicIntegrationProvider,
} from './integrations'

// The one error envelope every route returns — defined in ./errors.ts, re-exported here because
// `ApiError` is the name 250-odd call sites already know. `error` was a bare string with a sibling
// `detail: string[]`; it is now a nested object carrying requestId and retryable too
// (docs/api-reference.md § Errors).
export type { ApiError } from './errors.ts'
// --- Integrations: multi-row per provider (docs/workspaces-and-tasks.md). GitHub appears as a synthesized
// entry (id 'github') so it reads as "just another integration", while its encrypted token remains the
// Node's active provider credential. ---
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

// --- Workspaces: named groups of Projects (docs/workspaces-and-tasks.md). The top-level unit. ---
// When the worktree setup script runs: 'off' never, 'created' eagerly when the task is created,
// 'terminal' lazily when its terminal first opens (the default). null is treated as 'terminal'.
export type SetupTrigger = 'off' | 'created' | 'terminal'
// How the browser-preview pane resolves its URL: a fixed URL, http://localhost:<port>, or the
// stdout of a shell command run in the repo's worktree. null falls back to the dev-server port.
export type PreviewMode = 'url' | 'port' | 'script'
// Where the Database pane's AI-generation schema text comes from: live introspection of the
// connected Postgres, the stdout of a shell command, or a file in the worktree. null → 'auto'.
export type DbSchemaMode = 'auto' | 'script' | 'file'
// Preview-browser page rules (docs/panes.md): applied by the main process when a preview page
// loads. Discriminated unions so future triggers ('navigate', …) and actions ('click', 'js', …)
// extend without a schema change — stored as one JSON column on workspaces.
export type BrowserRuleAction = { type: 'fill'; selector: string; value: string }
export type BrowserRule = {
  id: string
  enabled: boolean
  urlPattern: string // substring match against the page URL; '*' = wildcard
  trigger: 'load'
  action: BrowserRuleAction
}
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
  icon: WorkspaceIcon | null
  color: string | null
  projects: WorkspaceProjectRef[]
}
export type WorkspaceSeed = { name: string }

// --- Projects: a folder on the node's machine, the unit a workspace groups (docs/workspaces-and-tasks.md).
// The successor to the (owner, name) repo keying. `vcs` and `github` are detected facets, not
// requirements: a plain folder has neither; a git checkout without a GitHub remote has only `vcs`;
// `path` is null for a project imported from GitHub but not yet cloned or mapped.
export type Project = {
  id: string
  name: string
  path: string | null
  workspaceId: string
  sort: number
  hidden: boolean
  vcs: 'git' | null
  defaultBranch: string | null
  remoteUrl: string | null
  github: { owner: string; name: string; repoId: number | null } | null
}
export type ProjectSeed = { path: string; workspaceId?: string; name?: string }
export type ProjectPatch = Partial<{ name: string; workspaceId: string; hidden: boolean; sort: number; path: string }>
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
export type ProjectConfigResponse = { projectId: string; config: ProjectConfig }

// --- Tasks: the Project -> Task unit of work (docs/workspaces-and-tasks.md/03). Rail rows. ---
// connectionId pins the link to a specific credential. providerId is stamped by core from that row.
export type TaskLink = { connectionId: string; providerId: string; identifier: string; ref?: ExternalRef }
export type TaskLinkSeed = { connectionId: string; identifier: string; ref?: Omit<ExternalRef, 'providerId' | 'connectionId'>; providerId?: string }
// A workspace's linked provider projects (docs/workspaces-and-tasks.md) — (integrationId, externalId) pairs.
export type WorkspaceExternalProject = { integrationId: string; externalId: string }
export type WorkspaceExternalProjectsResponse = { projects: WorkspaceExternalProject[] }
// A Lucide icon name (see core/client/ui/Icon.tsx). Shape-checked only, deliberately: the
// 1756-name map is client-side, and importing it into a route would breach the client↔node boundary
// that core/boundaries.test.ts enforces. An unrecognised name degrades to Icon's render-as-is
// fallback, so a bad value is cosmetic. Shared so the internal route and the public API agree.
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
  parentId: string | null // task tree (docs/workflows.md): fan-out children point at their root
  sort: number
  links: TaskLink[]
}
// The non-derived columns a new task needs, plus initial links. One create path for every
// Source (docs/workspaces-and-tasks.md/04). title is optional — the server seeds one from origin if absent.
export type TaskSeed = {
  title?: string
  icon?: string
  origin: Task['origin']
  projectId: string
  branch?: string
  pullNumber?: number
  links?: TaskLinkSeed[]
}

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
  task: { id: string; title: string; projectId: string; repo?: string; branch: string | null; worktreePath: string | null; pullNumber: number | null }
  sections: ContextSectionResult[]
  pr?: { number: number; title: string; body: string | null; changedFiles: string[] }
  issues: { provider: string; identifier: string; title: string; detail: string; cache: 'present' | 'missing' }[]
  notes: { slug?: string; scope?: 'global' | 'workspace' | 'task'; title: string; body: string }[]

  memory: { name: string; description: string }[]
}
export const taskContextRoute = (id: string, include?: TaskContextInclude[] | 'all') =>
  `/v2/core/tasks/${id}/context${include === 'all' ? '?include=*' : include?.length ? `?include=${include.join(',')}` : ''}`

// Agent tools (docs/agent-tools.md): the registry projects to the harness HTTP surface below and to
// the MCP server. The permissions page reads the static catalog and persists per-tier/per-tool
// toggles as ONE prefs slice under this key (JSON `{ tiers?, tools? }`).
export type ToolRisk = 'read' | 'write' | 'execute'
export const AGENT_TOOLS_PERMS_PREF_KEY = 'agentTools.perms'
export const agentToolsCatalogRoute = '/v2/core/agent-tools'
export type AgentToolCatalogEntry = { name: string; description: string; risk: ToolRisk; availability?: string }
export const rendererAgentToolRoute = (taskId: string, name: string) => `/v2/core/tasks/${taskId}/renderer-tools/${encodeURIComponent(name)}`


// Run targets (docs/workflows.md §2): the renderer shares the RunBridge routes the MCP run tools use
// (server/routes/harness.ts). Was the `run:*` IPC channels.
export const runTargetsRoute = (taskId: string) => `/v2/core/tasks/${taskId}/run`
export const runDefaultUrlRoute = (taskId: string) => `/v2/core/tasks/${taskId}/run/default-url`
export const runStartRoute = (taskId: string, targetId: string) => `/v2/core/tasks/${taskId}/run/${encodeURIComponent(targetId)}/start`
export const runStopRoute = (taskId: string, targetId: string) => `/v2/core/tasks/${taskId}/run/${encodeURIComponent(targetId)}/stop`
export const runStatusRoute = (taskId: string, targetId: string) => `/v2/core/tasks/${taskId}/run/${encodeURIComponent(targetId)}/status`

export type RepoConfigTrustReview = {
  taskId: string
  projectId: string | null
  trusted: boolean
  current: { hash: string; text: string; files: Array<{ path: string; content: string }> } | null
  previous: { hash: string; text: string; ackedAt: number } | null
}
export const repoConfigTrustRoute = (taskId: string) => `/v2/core/tasks/${taskId}/config-trust`




export const taskStatusesRoute = '/v2/core/task-statuses'
export const projectsRoute = '/v2/core/projects'
export const projectRoute = (id: string) => `${projectsRoute}/${encodeURIComponent(id)}`
export const projectDetectRoute = (id: string) => `${projectRoute(id)}/detect`
export const projectConfigRoute = (id: string) => `${projectRoute(id)}/config`
export const projectRunTargetsRoute = (id: string) => `${projectRoute(id)}/run-targets`
export const taskArchiveRoute = (id: string) => `/v2/core/tasks/${id}/archive`
export const taskPreviewUrlRoute = (id: string) => `/v2/core/tasks/${id}/preview-url`
export const taskOnCreatedRoute = (id: string) => `/v2/core/tasks/${id}/on-created`
export const taskMcpRoute = (id: string) => `/v2/core/tasks/${id}/mcp`
export const taskMcpStarterRoute = (id: string) => `/v2/core/tasks/${id}/mcp/starter`


export const prefsRoute = '/v2/core/prefs'
// Settings → Plugins (docs/ui-design.md § New surfaces). Per NODE: which plugins a node runs decides
// which routes exist and which SQLite files open, so this is node state and not a client preference.
//
// `running` and `disabled` are separate answers, not one. A toggle takes effect at the node's next
// start (plugins.md: "disabling unregisters contributions at next startup"), so between the save and the
// restart the two differ — which is exactly the state the page has to render rather than lie about.
export type NodePluginRow = { name: string; required: boolean; disabled: boolean; running: boolean }
export type NodePluginState = { plugins: NodePluginRow[]; restartRequired: boolean }
export const corePluginsRoute = '/v2/core/plugins'
// Every client paired with a node, and the revoke for one of them (docs/ui-design.md § New surfaces: "revoke this or
// other devices"). Device-only, like the plugin list — this is node administration.
export const coreDevicesRoute = '/v2/core/devices'
export const coreDeviceRoute = (deviceId: string) => `/v2/core/devices/${encodeURIComponent(deviceId)}`

// Settings → Security (docs/security.md § Audit, § On-disk).
//
// `diskEncrypted` is deliberately three-valued. `null` means "this node cannot tell" — the honest answer
// off macOS, where LUKS, dm-crypt, ZFS native encryption and a dozen NAS arrangements all count and
// probing for them badly would produce a confident wrong answer. A security warning that cries wolf is
// worse than no warning.
export type NodeSecurityPosture = { diskEncrypted: boolean | null; platform: string }
export const coreSecurityRoute = '/v2/core/security'

// The append-only audit trail. `details` is an allowlisted bag of scalars chosen per action — never a
// request body, a credential, or a file's contents.
export type AuditEntry = {
  id: string
  at: number
  actor: string
  actorId: string | null
  action: string
  subject: string | null
  details: Record<string, unknown> | null
}
// `nextBefore` is a TIMESTAMP cursor, not an offset: rows are only appended and pruned from the far end,
// so an offset would skip or repeat entries whenever the 90-day prune ran under a paging reader.
export type AuditPage = { entries: AuditEntry[]; nextBefore: number | null }
export const coreAuditRoute = '/v2/core/audit'

// `POST /v2/core/backup` (docs/data-layer.md § Backup). `destPath` is a path on the NODE's filesystem,
// which is why the client offers a native save dialog only for the local node. `excluded` is echoed back
// — and written into the archive's manifest — because "why is my GitHub token gone" is a question the
// backup itself should answer for whoever restores it a year later.
export type BackupResult = { path: string; bytes: number; files: string[]; excluded: string[] }
export type BackupSuggestion = { suggestedPath: string }
export const coreBackupRoute = '/v2/core/backup'

// Workspaces (named groups of Projects) — the top-level unit.
export const workspacesRoute = '/v2/core/workspaces'
export const workspaceRoute = (id: string) => `/v2/core/workspaces/${id}`
export const workspaceBootstrapRoute = '/v2/core/workspaces/bootstrap'
export const workspaceExternalProjectsRoute = (id: string) => `/v2/core/workspaces/${id}/external-projects`
// Tasks (Project -> Task units of work) — rail rows.
export const tasksRoute = '/v2/core/tasks'
export const taskRoute = (id: string) => `/v2/core/tasks/${id}`
export const taskLinksRoute = (id: string) => `/v2/core/tasks/${id}/links`
export const integrationsRoute = '/v2/core/integrations'
export const integrationRoute = (id: string) => `/v2/core/integrations/${id}`
export const integrationTestRoute = (id: string) => `/v2/core/integrations/${id}/test`

export const prefsKey = ['prefs'] as const
// The suffixes identify the current response shapes and prevent unrelated query data from sharing keys.
export const workspacesKey = ['workspaces', 'groups', 'v2'] as const
// The `v2` suffix identifies the current task response shape, including its required `icon` field.
export const projectsKey = ['projects', 'v2'] as const
// v3 removes the legacy repo pair and makes projectId/github/nullable branch explicit.
export const tasksKey = ['tasks', 'v3'] as const
// v3 adds descriptor metadata and normalized connection summaries. A distinct key prevents a
// persisted v2 `{ provider, connected }` row from hiding registry-driven sources/settings.
export const integrationsKey = ['integrations', 'v3'] as const
