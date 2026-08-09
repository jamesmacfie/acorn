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
//
// `state` is the third answer and the only one a restart cannot change: a plugin loaded from disk
// whose init threw is 'failed'. It is deliberately NOT folded into `running` — `restartRequired` is
// computed from `running`, and a restart cannot fix a broken plugin, so a failed row must not make
// the page demand one (docs/plugins.md).
export type NodePluginRow = {
  name: string
  required: boolean
  disabled: boolean
  running: boolean
  // 'pending-restart' is the fourth answer and the one phase 5 adds: a package sits on the node's disk
  // that this process never loaded — freshly installed, updated to a different version, or uninstalled
  // while still running. Like 'failed' it is about the package rather than the toggle, but unlike
  // 'failed' a restart is exactly what fixes it, so it DOES raise the banner.
  state: 'active' | 'failed' | 'disabled' | 'pending-restart'
  // Epoch millis, present only on a failed row.
  failedAt?: number
  // Present exactly when this plugin came off the node's disk rather than out of the app binary,
  // which also makes it the client's answer to "is this third-party?" (docs/third-party).
  installed?: InstalledPluginRow
}

// The major of @acorn/plugin-api a bundle was built against. A manifest that does not name exactly
// this value is skipped — "built for a newer/older acorn" is a clearer failure than a plugin that
// loads and then calls a `ctx` member that no longer exists.
//
// It lives here rather than being derived from packages/plugin-api/package.json: that manifest is
// `private` and its version is decorative, while THIS constant is a compatibility contract that has
// to change deliberately. @acorn/plugin-api re-exports it so plugin authors can assert against it.
//
// In protocol rather than node-core because both sides hold it against the same manifest: the node
// decides what to load, the device decides which of a fleet's bundles it can run.
export const PLUGIN_API_MAJOR = '1'

// What a plugin's manifest DECLARED. Not what is enforced: until loaded plugins move out of process
// the node block is context-shaping plus disclosure (docs/security.md § Design
// rules, rule 6), so every surface that renders this says "declared" and flips to "enforced" with no
// vocabulary change when the boundary lands.
export type NodePluginPermissions = {
  api: string[]
  events: string[]
  node: { core: string[]; capabilities: string[]; secrets: boolean; exec: boolean; net: string[] }
}

// One sandboxed rectangle the plugin's client bundle draws, as its manifest declared it
// (docs/plugins.md; the Zod schema is node-core/main/pluginManifest.ts).
// Hand-written here for the same reason NodePluginPermissions is: the node parses the manifest, and
// this is the projection the device registers contributions from.
export type PluginFrameSurface = {
  target: 'pane' | 'refPanel' | 'settings' | 'importer' | 'webview'
  // The contribution id, which is also a persisted layout key. Bound to the plugin by the HOST — a
  // bundle cannot claim a surface its manifest did not declare.
  id: string
  label: string
  glyph: string
  order: number
  formFactor: ('desktop' | 'mobile')[]
  providerId?: string
  group?: 'general' | 'workspace'
  // Webview-only. Exactly one URL form and a non-empty host list are guaranteed by the node's
  // manifest parser, then re-checked by the device before use because roster rows are untrusted wire.
  url?: string
  urlSource?: string
  hosts?: string[]
}
export type PluginWebviewGrant = { surface: string; label: string; hosts: string[] }

// ── Declarative chrome (docs/plugins.md) ───────────────────────────
//
// The other half of what a manifest may contribute: small chrome the HOST draws natively from data,
// with no plugin code in the renderer at all. Hand-written twins of the Zod schemas in
// node-core/main/pluginManifest.ts, for the same reason PluginFrameSurface is one — the node parses
// the manifest, and this is the projection the device registers contributions from.

// The closed verb set. `invoke` is deliberately absent in v1; adding a verb is additive.
export type PluginChromeAction =
  // A pane the same manifest declares. The selected row's id rides along as a pane intent.
  | { verb: 'openPane'; pane: string }
  | { verb: 'runNodeAction'; path: string }
  | { verb: 'createTask' }
  | { verb: 'openUrl'; url: string }

// Every `path`/`items`/`data` below is confined to the plugin's OWN route namespace when the node
// parses the manifest, and confined again on the device before it is fetched. Neither the prefix nor
// the check is spelled here: an architecture rule forbids this package from naming a plugin route at
// all, and the two halves that do the confining are node-core/main/pluginManifest.ts and
// client-core/plugins/chrome/data.ts.
export type PluginSourceDescriptor = {
  id: string
  label: string
  glyph: string
  order: number
  providerId?: string
  items: string
  onSelect?: PluginChromeAction
  refresh?: number
}
export type PluginSlotDescriptor = {
  id: string
  slot: 'footer'
  icon?: string
  data: string
  onClick?: PluginChromeAction
  refresh?: number
}
export type PluginPaletteDescriptor = { id: string; title: string; action: PluginChromeAction }
export type PluginAttentionDescriptor = { id: string; order: number; items: string; refresh?: number }
export type PluginNodeStatDescriptor = {
  id: string
  order: number
  label: [one: string, many: string]
  data: string
  refresh?: number
}
export type PluginContentLinkDescriptor = {
  id: string
  match: string
  openPane: string
  item: string
}

// What the descriptor routes answer with. Host-defined, unlike everything else a plugin route
// serves: the host is the one rendering these, so the shape is its contract and not the plugin's
// (docs/architecture-overview.md § Who owns which contract). Re-exported from @acorn/plugin-api so a
// plugin's node half types its handlers against the same declarations.
//
// The client still validates what arrives. These types describe the agreement; the roster row and the
// route body are both bytes from a node, and a malformed row is dropped rather than thrown into the shell.
export type PluginRailTask = {
  title?: string
  branch?: string
  // Reserved seed text. The current task model has no body column; retaining it on the descriptor
  // contract lets a future task-seed extension consume it without changing tracker row routes.
  body?: string
  link?: Pick<TaskLinkSeed, 'connectionId' | 'identifier' | 'ref'>
}
export type PluginRailItem = {
  id: string
  title: string
  subtitle?: string
  icon?: string
  badge?: string
  task?: PluginRailTask
}
export type PluginRailItems = { items: PluginRailItem[] }
// `null` hides the badge, which is how a badge with nothing to say disappears without the host
// needing a second route to ask.
export type PluginSlotBadge = { text: string; tone?: 'neutral' | 'accent' | 'warn'; tooltip?: string } | null
export type PluginAttentionWireItem = {
  id: string
  taskId?: string
  title: string
  detail?: string
  severity: 'info' | 'warn' | 'danger'
  // Epoch millis, for the relative time on the row.
  at: number
}
export type PluginAttentionItems = { items: PluginAttentionWireItem[] }
export type PluginNodeStatValue = { value: number }

// Still loose on the wire as well as in the schema, now that phase 4's keys are named: a client that
// does not know a future sibling key should contribute less rather than fail to parse. The arrays are
// optional because an older node's roster row will not carry them — every reader uses `?? []`.
export type PluginContributions = {
  frames: PluginFrameSurface[]
  sources?: PluginSourceDescriptor[]
  slots?: PluginSlotDescriptor[]
  palette?: PluginPaletteDescriptor[]
  attention?: PluginAttentionDescriptor[]
  nodeStats?: PluginNodeStatDescriptor[]
  contentLinks?: PluginContentLinkDescriptor[]
} & Record<string, unknown>

export type InstalledPluginRow = {
  version: string
  apiVersion: string
  permissions: NodePluginPermissions
  contributions: PluginContributions
  // The client bundle this node is offering, or null when the package has no client half. `hash` is
  // the sha256 the node computed from the file; it is a CACHE KEY HINT and nothing more — the device
  // hashes the bytes it received and refuses a mismatch, because a compromised node can lie here
  // (docs/plugins.md § Trust binds to bytes, not to claims).
  client: { hash: string; bytes: number } | null
  // Where the package came from, as one line for the settings row ("github:owner/repo@v1.2.0",
  // "npm:acorn-board", a URL). Absent for a package that predates the installer or was copied in by
  // hand, which is also why it is a display string and not the structured source: the roster's job is
  // to say where this came from, and only the node's lockfile has to be able to re-resolve it.
  source?: string
  // Epoch millis.
  installedAt?: number
}
export type NodePluginState = { plugins: NodePluginRow[]; restartRequired: boolean }

// Where a plugin package is fetched from (docs/plugins.md
// installer). `path` is a plugin author's dogfood loop and is refused outside a development build.
export type PluginInstallSource =
  | { github: string; tag?: string }
  | { npm: string; version?: string }
  | { url: string }
  | { path: string }

// Always restart-required: a plugin's routes, tables and jobs are wired at init, so nothing an install
// route can do makes the plugin live in the running process.
export type PluginInstallResult = { id: string; version: string; state: 'installed-restart-required' }
export type PluginUpdateResult = { id: string; fromVersion: string; toVersion: string; state: 'installed-restart-required' }
export type PluginUninstallResult = { restartRequired: boolean; dataPurged: boolean }

export const corePluginsRoute = '/v2/core/plugins'
export const corePluginInstallRoute = '/v2/core/plugins/install'
export const corePluginRoute = (id: string) => `/v2/core/plugins/${encodeURIComponent(id)}`
export const corePluginUpdateRoute = (id: string) => `/v2/core/plugins/${encodeURIComponent(id)}/update`
// The bundle bytes. Device-only like the roster: this is an owner surface, not a task surface, so a
// task-scoped internal token cannot reach it (server/index.ts mounts requireDevice over both forms).
export const corePluginBundleRoute = (id: string) => `/v2/core/plugins/${encodeURIComponent(id)}/client.js`
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
