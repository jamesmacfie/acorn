import type {
  ExternalRef,
  IntegrationAuthKind,
  IntegrationConnectionStatus,
  ProviderAccountRef,
  ProviderErrorCode,
  PublicIntegrationProvider,
} from './integrations'
import type { Cadence } from './schedules.ts'

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
// The projects ONE connection offers, for core's workspace picker. `id` is what a chosen row's
// `externalId` becomes; `label` is display-only and already bounded by the node
// (integrations/projectSource.ts) — the provider that produced it is not the authority on either.
export type IntegrationProject = { id: string; label: string }
export type IntegrationProjectsResponse = { projects: IntegrationProject[] }
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
  // Why it failed, in the words of whatever broke: the thrown message from a contained init/ready, or the
  // loader's own sentence for a manifest that does not parse, a bundle that will not import, an apiVersion
  // this node does not speak. Present only on a failed row, and absent rather than empty when the node is
  // older than this field — which is why it is optional, along with `stage` below: the per-node IndexedDB
  // query cache (docs/caching.md) has no version buster, so a REQUIRED field on a persisted response type
  // would have to arrive with a bumped query key. Optional avoids the whole question.
  //
  // UNTRUSTED DISPLAY TEXT. It originates in a loaded plugin's own throw, so it crosses the trust boundary
  // into the owner's UI: render it as text, never as markup, and expect it capped (the node caps it in
  // node-core/server/plugin/pluginState.ts).
  reason?: string
  // Which pass it died in, so the UI can say "failed to load" rather than "failed to start" for a package
  // that never got as far as running.
  stage?: 'load' | 'init' | 'ready'
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
// ── The loaded-plugin manifest contract ───────────────────────────────────────────────────────────
//
// One declaration, two consumers. The manifest's shape — its permissions, its frame surfaces, its
// declarative chrome — is the Zod schema in ./pluginContract.ts, and the types below are `z.infer` of
// it. Until recently this file carried a hand-written twin of all of it, ~330 lines kept in step with
// the node's schema by nothing at all, and the compiler could not help because the data crosses a
// process boundary as `unknown`. Re-exported rather than moved so the 134 importers of this file keep
// working; new code should import from ./pluginContract.ts directly.
export { PLUGIN_API_MAJOR } from './pluginApiVersion.ts'
export type {
  NodePluginPermissions,
  PluginAgentContextDescriptor,
  PluginAttentionDescriptor,
  PluginChromeAction,
  PluginClientRouteDescriptor,
  PluginCommandAction,
  PluginCommandCategory,
  PluginCommandDescriptor,
  PluginContentLinkDescriptor,
  PluginContributions,
  PluginDocumentCompletions,
  PluginDocumentRegion,
  PluginFrameSurface,
  PluginKeybindingDescriptor,
  PluginNodeStatDescriptor,
  PluginPaletteDescriptor,
  PluginPaneLayout,
  PluginRefResolverDescriptor,
  PluginSlotDescriptor,
  PluginSourceDescriptor,
  PluginSourceEmptyState,
  PluginThemeDescriptor,
} from './pluginContract.ts'

// The two grants the DEVICE derives from a manifest's frame surfaces and records against a trust
// decision. Not manifest shapes: they are what the owner consented to, one row per surface.
export type PluginWebviewGrant = { surface: string; label: string; hosts: string[] }
export type PluginKeyClaimGrant = { surface: string; label: string; chords: string[] }

// The third: what this package's manifest says about OTHER packages and about core's own surfaces
// (@acorn/protocol/extensionPoints.ts). One shape for all three kinds rather than three arrays, because
// they are one question an owner asks once — "what does this reach that is not its own?" — and because a
// trust record with three near-identical lists is three places for one of them to be forgotten.
//
//   hosts     this package opens one of its surfaces to other packages' rows.
//   extends   this package puts its rows inside another package's surface. `target` names that package.
//   replaces  this package offers to draw one of core's own surfaces. An OFFER: nothing is replaced
//             until the owner picks it in settings.
export type PluginExtensionGrant = {
  kind: 'hosts' | 'extends' | 'replaces'
  // A point reference, or a designated core slot id. Never free text.
  target: string
  label: string
}

// The fourth: periodic work the node will run for this package with no client open
// (docs/schedules.md). Recorded like the three above rather than merely shown, for the reason stated
// there — the update prompt's "what is new" mark is a set difference against what the owner last
// approved, and a grant that is not stored can never read as newly requested. A package that starts
// running itself every five minutes where it used to run daily has grown its reach.
export type PluginScheduleGrant = { id: string; label: string; cadence: Cadence }

// What the descriptor routes answer with. Host-defined, unlike everything else a plugin route
// serves: the host is the one rendering these, so the shape is its contract and not the plugin's
// (docs/architecture-overview.md § Who owns which contract). Re-exported from @acorn/plugin-api so a
// plugin's node half types its handlers against the same declarations.
//
// The client still validates what arrives. These types describe the agreement; the roster row and the
// route body are both bytes from a node, and a malformed row is dropped rather than thrown into the shell.
export type PluginRailTask = {
  // Optional so established providers can preserve their pre-loader task origin. Other plugins use
  // the host-derived `<plugin>:item` value and never need to set it.
  origin?: string
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

// A rail row's `id` has to survive a round trip the plugin does not control: the host hands it back
// verbatim as the pane frame's `context.item`, and the frame has to recover the row's full identity
// from that one string. Two halves, because a provider's own identifier is not globally unique — two
// connected Linear workspaces can share a team prefix, two Rollbar projects an item number — so the
// connection travels with it.
//
// Percent-encoded around a single `:` because either half may legitimately contain the delimiter.
// Here rather than in each plugin because round-tripping a rail id is the HOST's contract; linear and
// rollbar had written the same twenty lines, and the second one's comment said so.
export const railItemId = (connectionId: string, identifier: string): string =>
  `${encodeURIComponent(connectionId)}:${encodeURIComponent(identifier)}`

/** The inverse. `null` for anything that is not one of ours — a truncated id, a bad escape, an empty
 * half — so a caller branches once instead of validating the parts itself. */
export function parseRailItemId(value: string): [connectionId: string, identifier: string] | null {
  const separator = value.indexOf(':')
  if (separator <= 0 || separator === value.length - 1) return null
  try {
    const connectionId = decodeURIComponent(value.slice(0, separator))
    const identifier = decodeURIComponent(value.slice(separator + 1))
    return connectionId && identifier ? [connectionId, identifier] : null
  } catch {
    return null
  }
}
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

export type InstalledPluginRow = {
  version: string
  apiVersion: string
  permissions: import('./pluginContract.ts').NodePluginPermissions
  contributions: import('./pluginContract.ts').PluginContributions
  // Brand marks the manifest declared: one SVG path's `d` in a 24 box, never an SVG document. The
  // device registers `icon` as `brand:<pluginId>` and each `icons` key as `brand:<pluginId>/<key>`,
  // stamping the prefix from the roster row so a package cannot claim another's mark. See
  // client-core/ui/brandMarks.ts and docs/ui-design.md § Icons.
  icon?: { d: string }
  icons?: Record<string, { d: string }>
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
// An install the AGENT asked for and the OWNER has not answered yet (docs/plugins.md § Approval-mediated
// install). Raised by the `plugin_request` agent tool, which cannot install anything: the record is inert
// until a device reads it here and performs the install over the device-gated install route with its own
// principal. A prompt-injected agent can produce this row and nothing else.
export type PluginApprovalRequest = {
  requestId: string
  // The task whose agent asked. The notification pipeline is task-scoped, and it is also the answer to
  // "who asked for this" when the audit row is read back.
  taskId: string
  action: 'install' | 'update' | 'uninstall'
  // Present for an install, exactly as the agent gave it. Nothing has been fetched at this point — see
  // docs/plugins.md § What the owner can know before the download.
  source?: PluginInstallSource
  // Present for an update or an uninstall.
  pluginId?: string
  // The agent asked for dev mode: on approval the device records a per-(plugin, node) grant that
  // auto-trusts future bundles of this plugin until the owner ends it (docs/security.md § The dev grant).
  dev: boolean
  purgeData?: boolean
  // UNTRUSTED DISPLAY TEXT written by an agent that may be reading hostile content. Capped by the tool's
  // input schema; render it as text, never as markup, and never let it stand in for reading the request.
  reason?: string
  requestedAt: number
}

// `requests` is optional so a node that predates approval-mediated install still parses, and so this
// response type can gain the field without a query-key bump (docs/caching.md).
export type NodePluginState = { plugins: NodePluginRow[]; restartRequired: boolean; requests?: PluginApprovalRequest[] }

// Where a plugin package is fetched from (docs/plugins.md installer). `path` is an absolute directory on
// the NODE's filesystem, allowed on every build and symlinked rather than copied, so it is the one source
// whose bytes are not pinned (docs/security.md § Installing from a folder).
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

// The one exception to the line above, and only for a plugin the node LOADED from disk: a reload swaps
// its node half in the running process (docs/plugins.md § The dev loop). `failed` is a 200, not an error:
// candidate-then-commit means a failed reload changed nothing, the previous instance is still serving,
// and `reason` is the same text the roster row now carries.
export type PluginReloadResult = { id: string; version: string; state: 'reloaded' | 'failed'; reason?: string }

export const corePluginsRoute = '/v2/core/plugins'
export const corePluginInstallRoute = '/v2/core/plugins/install'
export const corePluginRoute = (id: string) => `/v2/core/plugins/${encodeURIComponent(id)}`
export const corePluginUpdateRoute = (id: string) => `/v2/core/plugins/${encodeURIComponent(id)}/update`
export const corePluginReloadRoute = (id: string) => `/v2/core/plugins/${encodeURIComponent(id)}/reload`
// The owner's answer to one agent-raised approval request. Device-only like the rest of this family, and
// permanently unmappable from a plugin frame: an approval a frame could post would turn the request/decision
// split back into an install route the agent can reach (client-core/plugins/frames/scopes.ts).
export const corePluginRequestRoute = (requestId: string) => `/v2/core/plugins/requests/${encodeURIComponent(requestId)}`
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

// Schedules: periodic work owned by the node (docs/schedules.md). The row and cadence types live in
// ./schedules.ts, which needs zod for the cadence parser this module deliberately does not carry.
//
// A key contains a colon ('core:audit-prune'), so every builder below encodes it.
export const schedulesRoute = '/v2/core/schedules'
export const scheduleRoute = (key: string) => `${schedulesRoute}/${encodeURIComponent(key)}`
export const scheduleRunNowRoute = (key: string) => `${scheduleRoute(key)}/run`
export const scheduleRunsRoute = (key: string) => `${scheduleRoute(key)}/runs`
/** What this node can actually run, for the creation picker. Only what resolves is offered, so a
 *  schedule can never be created against something that does not exist. */
export const scheduleTargetsRoute = `${schedulesRoute}/targets`
/** Re-take consent after a target's declared risk tier rose. The client cannot NAME a tier here — it
 *  posts nothing and the node re-stamps from the registry — so accepting is always accepting the tier
 *  the host just showed, which is what makes the confirmation impossible to talk out of asking. */
export const scheduleConfirmRoute = (key: string) => `${scheduleRoute(key)}/confirm`

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
export const integrationProjectsRoute = (id: string) => `/v2/core/integrations/${id}/projects`

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
