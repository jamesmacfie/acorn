import type {
  ExternalRef,
  IntegrationAuthKind,
  IntegrationConnectionStatus,
  ProviderAccountRef,
  ProviderErrorCode,
  PublicIntegrationProvider,
} from './integrations'
import type { ExtensionPointKind, HookMode } from './extensionPoints.ts'
import type { Cadence } from './schedules.ts'
import type { NodeAttachment } from './node.ts'
import type { TelemetryRecord } from './telemetry.ts'

// The one error envelope every route returns, defined in ./errors.ts and re-exported here because
// `ApiError` is the name 250-odd call sites know. See docs/api-reference.md § Errors.
export type { ApiError } from './errors.ts'
// --- Integrations: multi-row per provider (docs/workspaces-and-tasks.md). GitHub appears as a
// synthesized entry (id 'github') so it reads as just another integration, while its encrypted token
// stays the node's active provider credential. ---
export type IntegrationProvider = string
export type Integration = {
  id: string // 'github' for the synthesized entry; opaque uuid otherwise
  providerId: IntegrationProvider
  // Seeded from the provider, rewritten on every rotate. Read `name` first when showing a connection
  // to someone: use `connectionName` rather than either field on its own.
  label: string
  // What the owner called this connection. Absent until they rename it, which is why every surface
  // has to fall back to `label`.
  name?: string
  status: IntegrationConnectionStatus
  authKind: IntegrationAuthKind
  account: ProviderAccountRef | null
  scopes: string[]
  capabilities: Record<string, 'available' | 'missing-scope' | 'degraded'>
  createdAt: number
  updatedAt: number
  lastValidatedAt?: number
  lastError?: ProviderErrorCode
  // Set when this connection's credential is a 1Password reference rather than a stored token. The
  // reference itself, so the UI can show which item it points at. A reference is a pointer, not a
  // secret; the value behind it never crosses the wire.
  secretRef?: string
}
// Whether the `op` CLI is runnable on the node, for Settings → Security. Not a preference: the
// preference is whether to use it, and that is the row below.
export type OnePasswordStatus = { available: boolean; version?: string }

// Settings → Security → 1Password, as one preference row, because it is one decision: whether this
// node may shell out to `op`, and how long it may remember what it read. `ttlMs: null` means until
// the node restarts.
//
// Here rather than on either side, because both sides parse it: the client to draw the controls, the
// node to decide whether to run anything. Two copies of this shape would drift, and the way they
// would drift is a switch that reads as off on one side and on on the other.
export const ONEPASSWORD_PREF_KEY = 'onepassword'
export type OnePasswordPref = { enabled: boolean; ttlMs: number | null }
export const ONEPASSWORD_PREF_DEFAULT: OnePasswordPref = { enabled: false, ttlMs: null }

// A half-written or corrupt value reads as off. Failing open would shell out to a binary nobody
// asked us to run.
export function parseOnePasswordPref(raw: string | null | undefined): OnePasswordPref {
  if (!raw) return ONEPASSWORD_PREF_DEFAULT
  try {
    const parsed = JSON.parse(raw) as Partial<OnePasswordPref>
    return {
      enabled: parsed.enabled === true,
      ttlMs: typeof parsed.ttlMs === 'number' && parsed.ttlMs > 0 ? parsed.ttlMs : null,
    }
  } catch {
    return ONEPASSWORD_PREF_DEFAULT
  }
}

export type IntegrationsResponse = { providers: PublicIntegrationProvider[]; integrations: Integration[] }
// Credential values are write-only: the response contains only the normalized connection summary.
export type ConnectIntegrationRequest = { providerId: IntegrationProvider; credentials: Record<string, string> }
export type RotateIntegrationRequest = { credentials: Record<string, string> }

// --- Workspaces: named groups of Projects (docs/workspaces-and-tasks.md). The top-level unit. ---
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

// --- Projects: a folder on the node's machine, the unit a workspace groups
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
export type ProjectConfigResponse = { projectId: string; config: ProjectConfig }

// --- Tasks: the Project -> Task unit of work (docs/workspaces-and-tasks.md). Rail rows. ---
// connectionId pins the link to a specific credential. providerId is stamped by core from that row.
export type TaskLink = { connectionId: string; providerId: string; identifier: string; ref?: ExternalRef }
export type TaskLinkSeed = { connectionId: string; identifier: string; ref?: Omit<ExternalRef, 'providerId' | 'connectionId'>; providerId?: string }
// A workspace's linked provider projects (docs/workspaces-and-tasks.md): (integrationId, externalId)
// pairs. `projectId` narrows the link to one project in that workspace; leave it off and the link
// covers every project there.
export type WorkspaceExternalProject = { integrationId: string; externalId: string; projectId?: string }
export type WorkspaceExternalProjectsResponse = { projects: WorkspaceExternalProject[] }
// The same links read and written from the connection's side rather than a workspace's, which is how
// Settings shows one integration's whole map at once (docs/integrations.md § Project sources).
export type IntegrationMapping = { workspaceId: string; externalId: string; projectId?: string }
export type IntegrationMappingsResponse = { mappings: IntegrationMapping[] }
// The projects one connection offers, for core's workspace picker. `id` is what a chosen row's
// `externalId` becomes; `label` is display-only and already bounded by the node
// (integrations/projectSource.ts). The provider that produced it is not the authority on either.
export type IntegrationProject = { id: string; label: string }
export type IntegrationProjectsResponse = { projects: IntegrationProject[] }
// A Lucide icon name (see core/client/ui/Icon.tsx). Shape-checked only, because the 1756-name map is
// client-side and importing it into a route would breach the client/node boundary. An unrecognised
// name falls back to Icon's render-as-is, so a bad value is cosmetic.
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
// The non-derived columns a new task needs, plus initial links. One create path for every source
// (docs/workspaces-and-tasks.md). `title` is optional; the server seeds one from origin.
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
  // Reference data supplied by a section. Loaded contributors cannot supply a renderer or an action;
  // consumers may show these as provenance labels.
  sources?: { label: string; uri?: string }[]
}
export type ContextSectionResult = {
  id: string
  label: string
  defaultIncluded: boolean
  budget: ContextBudget
  items: ContextItem[]
  compact: string
  omitted: number
  absent?: { reason: 'missing-cache' | 'unavailable' | 'timeout' | 'invalid-response'; detail: string }
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
// the MCP server. The permissions page reads the static catalog and persists per-tier and per-tool
// toggles as one prefs slice under this key (JSON `{ tiers?, tools? }`).
export type ToolRisk = 'read' | 'write' | 'execute'
export const AGENT_TOOLS_PERMS_PREF_KEY = 'agentTools.perms'
export const agentToolsCatalogRoute = '/v2/core/agent-tools'
export type AgentToolCatalogEntry = { name: string; description: string; risk: ToolRisk; availability?: string }
export const rendererAgentToolRoute = (taskId: string, name: string) => `/v2/core/tasks/${taskId}/renderer-tools/${encodeURIComponent(name)}`


// Run targets (docs/workflows.md § Routes and UI): the renderer shares the RunBridge routes the MCP
// run tools use (server/routes/plugins/harness.ts). Replaced the `run:*` IPC channels.
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
// What every plugin has to say about archiving this task, asked once when the dialog opens
// (node-core/server/pluginHost/taskChecks.ts).
export const taskArchiveConcernsRoute = (id: string) => `/v2/core/tasks/${id}/archive-concerns`
export const taskPreviewUrlRoute = (id: string) => `/v2/core/tasks/${id}/preview-url`
export const taskOnCreatedRoute = (id: string) => `/v2/core/tasks/${id}/on-created`
export const taskMcpRoute = (id: string) => `/v2/core/tasks/${id}/mcp`
export const taskMcpStarterRoute = (id: string) => `/v2/core/tasks/${id}/mcp/starter`


export const prefsRoute = '/v2/core/prefs'
// Where every runtime that is not the node posts its telemetry (docs/telemetry.md § Other runtimes).
// Device-only, because a record admitted here reaches every sink, and a sink can send it off the
// machine.
export const coreTelemetryRoute = '/v2/core/telemetry'
// What Settings → Telemetry draws: counters, never records (docs/telemetry.md § What the page
// shows). Device-only, like the route above, and for a smaller reason: it names which plugins are
// reading the stream, which is a fact about this machine's installation.
export const coreTelemetrySummaryRoute = '/v2/core/telemetry/summary'

/** The node's own account of what it has collected since it started.
 *
 *  Counters rather than a window over the ring. The ring holds 5,000 records and a sink may have
 *  drained it a second ago, so a page built on the ring would answer "what is being collected" with
 *  whatever happened in the last five seconds. */
export type TelemetrySummary = {
  /** The `telemetry.enabled` preference, as the collector last read it. */
  enabled: boolean
  /** The preference on and at least one sink subscribed, which is what it takes to build a record. */
  collecting: boolean
  /** When this node's collector started, in epoch milliseconds. Every count below is since then. */
  since: number
  /** When a batch last went to the sinks, or null when none has. */
  lastFlushAt: number | null
  /** Records the ring dropped at its cap, and attributes cut at theirs. */
  dropped: number
  truncated: number
  /** Who is reading the stream, by plugin id. `core` is the node's own, such as the `ACORN_PERF`
   *  printer. */
  sinks: string[]
  /** One row per owner and kind, so the page can say what each plugin is producing. */
  records: Array<{ owner: string; kind: TelemetryRecord['kind']; count: number }>
}
// Settings → Plugins (docs/plugins.md § Activation). Per node, since which plugins a node runs
// decides which routes exist and which SQLite files open. `running` and `disabled` answer different
// questions: a toggle takes effect at the node's next start, so the page shows the gap between saving
// and restarting.
//
// `state` is the third answer, the only one a restart cannot change: a plugin loaded from disk whose
// init threw is `'failed'`. It stays out of `running` because `restartRequired` is computed from
// `running` alone, and a restart cannot fix a broken plugin (docs/plugins.md § Loaded plugins).
export type NodePluginRow = {
  name: string
  /** Events this running or installed plugin declares for cross-plugin subscribers. */
  emits?: readonly import('./plugin/contract.ts').PluginEmit[]
  required: boolean
  disabled: boolean
  running: boolean
  // 'pending-restart' means a package sits on the node's disk that this process never loaded: freshly
  // installed, updated, or uninstalled while still running. Like 'failed' it's about the package
  // rather than the toggle, but unlike 'failed' a restart fixes it, so it does raise the banner.
  state: 'active' | 'failed' | 'disabled' | 'pending-restart'
  // Epoch millis, present only on a failed row.
  failedAt?: number
  // Why it failed, in the words of whatever broke: the thrown message from a contained init or ready,
  // or the loader's own sentence for a manifest that doesn't parse. Optional, along with `stage`,
  // because the per-node IndexedDB query cache has no version buster and a required field on a
  // persisted response type would need a bumped query key (docs/caching.md).
  //
  // Untrusted display text. It comes from a loaded plugin's own throw, so render it as text, never as
  // markup. The node caps it in node-core/server/pluginHost/state.ts.
  reason?: string
  // Which pass it died in, so the UI can say "failed to load" rather than "failed to start".
  stage?: 'load' | 'init' | 'ready'
  // Present exactly when this plugin came off the node's disk rather than the app binary, which makes
  // it the client's answer to "is this third-party?" (docs/third-party).
  installed?: InstalledPluginRow
}

// The major of @acorn/plugin-api a bundle was built against. A manifest that doesn't name exactly this
// value is skipped: "built for a newer acorn" is a clearer failure than a plugin that loads and then
// calls a `ctx` member that no longer exists.
//
// Here rather than derived from packages/plugin-api/package.json, whose version is decorative because
// the package is private. This constant is the compatibility contract itself, and @acorn/plugin-api
// re-exports it so plugin authors can assert against it. See docs/plugins.md § Activation for what
// bumping it costs.
//
// In protocol because both sides hold it against the same manifest: the node decides what to load,
// and the device decides which of a fleet's bundles it can run.

// The loaded-plugin manifest contract.
//
// One declaration, two consumers. The manifest's shape is the Zod schema in ./pluginContract.ts and
// the types below are `z.infer` of it. This file used to carry a hand-written twin, ~330 lines kept in
// step by nothing at all. Re-exported rather than moved so the 134 importers keep working; new code
// should import from ./pluginContract.ts directly.
export { PLUGIN_API_MAJOR } from './plugin/apiVersion.ts'
export type {
  NodePluginPermissions,
  PluginAgentContextDescriptor,
  PluginAttentionDescriptor,
  PluginChromeAction,
  PluginClientRouteDescriptor,
  PluginCommandAction,
  PluginCommandCategory,
  PluginCommandDescriptor,
  PluginCommandSelectAction,
  PluginContentLinkDescriptor,
  PluginContributions,
  PluginDocumentCompletions,
  PluginDocumentRegion,
  PluginFrameSurface,
  PluginKeybindingDescriptor,
  PluginNodeStatDescriptor,
  PluginPaletteDescriptor,
  PluginPaneRegion,
  PluginRefResolverDescriptor,
  PluginSlotDescriptor,
  PluginSourceDescriptor,
  PluginSourceEmptyState,
  PluginThemeDescriptor,
} from './plugin/contract.ts'

// The frame grants the device derives from a manifest's surfaces and records against a trust
// decision. Not manifest shapes: they're what the owner consented to, one row per surface.
export type PluginWebviewGrant = { surface: string; label: string; hosts: string[] }
export type PluginKeyClaimGrant = { surface: string; label: string; chords: string[] }
// A host-mediated jump from this package's UI into a target another client plugin owns. The target is
// a notice kind, never a pane id or route; storing it makes a newly added cross-owner destination
// visible in the update prompt.
export type PluginNavigationDestinationGrant = {
  surface: string
  label: string
  destination: string
  targetKind: string
  noticeKind?: string
}

// The third grant: what this package's manifest says about other packages and about core's own
// surfaces (@acorn/protocol/extensionPoints.ts). One shape for all three kinds rather than three
// arrays, because they answer one question an owner asks once, "what does this reach that isn't its
// own?", and three near-identical lists are three places to forget one.
//
//   hosts     this package opens one of its surfaces to other packages' rows.
//   extends   this package puts its rows inside another package's surface. `target` names that package.
//   replaces  this package offers to draw one of core's own surfaces. Nothing is replaced until the
//             owner picks it in settings.
export type PluginExtensionGrant = {
  kind: 'hosts' | 'extends' | 'replaces'
  // Which of the five things is opened, or brought (@acorn/protocol/extensionPoints.ts). Absent on
  // `replaces`, which is the exclusive slot rather than a point. On `extends` it is derived from the
  // carrier this manifest named, because a contributor cannot see the owner's declaration.
  pointKind?: ExtensionPointKind
  // `hook` contributions only: what the handler asks to do. It is the difference between "can watch a
  // push" and "can stop a push", so it belongs in the grant and in the key.
  mode?: HookMode
  // A point reference, or a designated core slot id. Never free text.
  target: string
  label: string
}

// The fourth grant: periodic work the node runs for this package with no client open
// (docs/schedules.md). Recorded rather than merely shown, because the update prompt's "what's new"
// mark is a set difference against what the owner last approved. A package that starts running itself
// every five minutes where it used to run daily has grown its reach.
export type PluginScheduleGrant = { id: string; label: string; cadence: Cadence }

// The fifth grant: a check this package runs when the owner archives a task, and whether it offers to
// clean up after it (node-core/server/pluginHost/taskChecks.ts). Recorded for the same reason as the
// fourth: `cleansUp` in the key is what lets the update prompt say a package that used to only warn
// now does something.
export type PluginTaskCheckGrant = { id: string; cleansUp: boolean }

// The sixth grant, and the only one under `Enforced` that names a program: a managed agent harness
// this package asks acorn to run (docs/managed-agents.md § Harnesses). The claim is exact, since the
// host spawns the declared command with the declared args and nothing else, so the whole spawn goes
// in the key. A version that runs a different binary, or carries more of the node's environment into
// it, has to reach the update prompt.
export type PluginHarnessGrant = {
  id: string
  label: string
  // `command` is an executable off PATH. `entry` is JavaScript this package ships, run with the node
  // service's own binary.
  kind: 'command' | 'entry'
  // The command line, or the package-relative entry path, with its declared arguments.
  run: string
  // Config variables carried from the node's environment into the agent, by name or glob.
  env: string[]
  // The second invocation, when the harness declares a one-shot text mode: the same command line the
  // Generate lists spend. Absent means the harness runs only as a session.
  oneShot?: string
}

// Loaded tool and context descriptors are executable/data-bearing surfaces in the same trust
// snapshot as schedules and harnesses. Routes are intentionally absent: manifest validation binds
// those to the declaring package, while these fields capture every way an update can widen what the
// host will expose or return.
export type PluginAgentToolGrant = {
  id: string
  description: string
  risk: 'read' | 'write' | 'execute'
  requiresSession: boolean
  maxOutputBytes: number
}

export type PluginContextSectionGrant = {
  id: string
  label: string
  defaultIncluded: boolean
  maxBytes: number
  maxTokens: number
}

// What the descriptor routes answer with. Host-defined, unlike everything else a plugin route serves,
// because the host renders these (docs/architecture-overview.md § Who owns which contract).
// Re-exported from @acorn/plugin-api so a plugin's node half types its handlers against the same
// declarations.
//
// The client still validates what arrives: a roster row and a route body are both bytes from a node,
// and a malformed row is dropped rather than thrown into the shell.
export type PluginRailTask = {
  // Optional so established providers can keep their pre-loader task origin. Other plugins use the
  // host-derived `<plugin>:item` value.
  origin?: string
  title?: string
  branch?: string
  // The item's own text: a Linear issue's description, a Rollbar item's facts. The task model has no
  // body column, so nothing is written with it; what reads it is the workflow start from a row menu,
  // which puts the title and this under an `issue` input (docs/workflows.md § Starting a run).
  body?: string
  link?: Pick<TaskLinkSeed, 'connectionId' | 'identifier' | 'ref'>
}
export type PluginRailItem = {
  id: string
  title: string
  /** One pre-joined line of secondary text. For several facts use `fields`, which the host lays out as
   *  columns. linear and rollbar both built a facts array and flattened it with ` · `, and that's what
   *  stopped their lists reading like github's aligned one. */
  subtitle?: string
  /** Ordered secondary facts, one per column. The host reserves the same track width for each, so
   *  the Nth fact lines up down the whole list. Wins over `subtitle` when both are present. */
  fields?: string[]
  /** Draw the aligned fields between the leading icon and title. The default keeps the title first. */
  fieldsFirst?: boolean
  icon?: string
  /** Semantic severity for the icon; the host owns its actual colour. */
  severity?: 'info' | 'warn' | 'danger'
  badge?: string
  task?: PluginRailTask
}
export type PluginRailItems = { items: PluginRailItem[] }

// A rail row's `id` survives a round trip the plugin doesn't control: the host hands it back verbatim
// as the pane frame's `context.item`, and the frame recovers the row's full identity from that one
// string. Two halves, because a provider's own identifier isn't globally unique. Two connected Linear
// workspaces can share a team prefix, so the connection travels with it.
//
// Percent-encoded around a single `:` because either half may contain the delimiter. Here rather than
// in each plugin because round-tripping a rail id is the host's contract; linear and rollbar had each
// written the same twenty lines.
export const railItemId = (connectionId: string, identifier: string): string =>
  `${encodeURIComponent(connectionId)}:${encodeURIComponent(identifier)}`

/** The inverse. `null` for anything that is not one of ours: a truncated id, a bad escape, an
 * empty half. A caller branches once instead of validating the parts itself. */
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
// `null` hides the badge, so a badge with nothing to say disappears without a second route.
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
  // What the manifest declared that the node has no meaning for: an unknown top-level key, an unknown
  // contribution kind, an unknown `permissions.node.core` facet. Absent when there is nothing to report.
  //
  // The forward-compatibility rule is that unknown is retained and reported, never dropped silently
  // (docs/plugins.md § Forward compatibility). This is the reporting half: the device raises one
  // attention row per entry, on the same path a surface that failed to register takes.
  unknown?: readonly string[]
  permissions: import('./plugin/contract.ts').NodePluginPermissions
  contributions: import('./plugin/contract.ts').PluginContributions
  // What the plugin declared other plugins may hear (docs/plugins.md § Hearing another plugin). Optional
  // rather than defaulted for the same reason `reason` is: this row is persisted in the query cache
  // and a required field would need a bumped key.
  emits?: readonly import('./plugin/contract.ts').PluginEmit[]
  // Brand marks the manifest declared: one SVG path's `d` in a 24 box, never an SVG document, plus the
  // brand's own colour as a six-digit hex. The device registers `icon` as `brand:<pluginId>` and each
  // `icons` key as `brand:<pluginId>/<key>`, stamping the prefix from the roster row so a package can't
  // claim another's mark. See client-core/kit/tokens/brandMarks.ts and docs/ui-design.md § Icons.
  icon?: { d: string; color?: string }
  icons?: Record<string, { d: string; color?: string }>
  // The client bundle this node is offering, or null when the package has no client half. `hash` is
  // the sha256 the node computed, and it's a cache-key hint only: the device hashes the bytes it
  // received and refuses a mismatch, because a compromised node can lie here
  // (docs/security.md § Third-party plugin bundles).
  client: { hash: string; bytes: number } | null
  // Where the package came from, as one line for the settings row ("github:owner/repo@v1.2.0",
  // "npm:acorn-board", a URL). Absent for a package that predates the installer or was copied in by
  // hand. A display string rather than the structured source, because only the node's lockfile has to
  // re-resolve it.
  source?: string
  // The app seeded this package. It has no lockfile, so the node cannot update it and the settings row
  // offers no update or uninstall. Structured rather than sniffed from `source`, which is display text.
  bundled?: true
  // Epoch millis.
  installedAt?: number
}
// An install the agent asked for and the owner hasn't answered yet (docs/plugins.md §
// Approval-mediated install). Raised by the `plugin_request` agent tool, which can't install anything:
// the record is inert until a device reads it and installs over the device-gated route with its own
// principal. A prompt-injected agent can produce this row and nothing else.
export type PluginApprovalRequest = {
  requestId: string
  // The task whose agent asked. The notification pipeline is task-scoped, and this also answers "who
  // asked for this" when the audit row is read back.
  taskId: string
  action: 'install' | 'update' | 'uninstall'
  // Present for an install, exactly as the agent gave it. Nothing has been fetched yet. See
  // docs/plugins.md § What the owner can know before the download.
  source?: PluginInstallSource
  // Present for an update or an uninstall.
  pluginId?: string
  // The agent asked for dev mode: on approval the device records a per-(plugin, node) grant that
  // auto-trusts future bundles until the owner ends it (docs/security.md § The dev grant).
  dev: boolean
  purgeData?: boolean
  // Untrusted display text written by an agent that may be reading hostile content. Capped by the
  // tool's input schema. Render it as text, never as markup, and never let it stand in for reading the
  // request.
  reason?: string
  requestedAt: number
}

// `requests` is optional so a node that predates approval-mediated install still parses, and so this
// response type can gain the field without a query-key bump (docs/caching.md).
export type NodePluginState = { plugins: NodePluginRow[]; restartRequired: boolean; requests?: PluginApprovalRequest[] }

// Where a plugin package is fetched from (docs/plugins.md installer). `path` is an absolute directory
// on the node's filesystem, allowed on every build and symlinked rather than copied, so it's the one
// source whose bytes aren't pinned (docs/security.md § Installing from a folder).
export type PluginInstallSource =
  | { github: string; tag?: string }
  | { npm: string; version?: string }
  | { url: string }
  | { path: string }

// Always restart-required: a plugin's routes, tables and jobs are wired at init, so nothing an install
// route does makes the plugin live in the running process.
export type PluginInstallResult = { id: string; version: string; state: 'installed-restart-required' }
export type PluginUpdateResult = { id: string; fromVersion: string; toVersion: string; state: 'installed-restart-required' }
export type PluginUninstallResult = { restartRequired: boolean; dataPurged: boolean }

// The one exception, and only for a plugin the node loaded from disk: a reload swaps its node half in
// the running process (docs/plugins.md § The dev loop). `failed` is a 200, not an error, because
// candidate-then-commit means a failed reload changed nothing and the previous instance still serves.
export type PluginReloadResult = { id: string; version: string; state: 'reloaded' | 'failed'; reason?: string }

export const corePluginsRoute = '/v2/core/plugins'
export const corePluginInstallRoute = '/v2/core/plugins/install'
export const corePluginRoute = (id: string) => `/v2/core/plugins/${encodeURIComponent(id)}`
export const corePluginUpdateRoute = (id: string) => `/v2/core/plugins/${encodeURIComponent(id)}/update`
export const corePluginReloadRoute = (id: string) => `/v2/core/plugins/${encodeURIComponent(id)}/reload`
// The owner's answer to one agent-raised approval request. Device-only, and permanently unmappable
// from a plugin frame: an approval a frame could post would turn the request/decision split back into
// an install route the agent can reach (client-core/host/frames/scopes.ts).
export const corePluginRequestRoute = (requestId: string) => `/v2/core/plugins/requests/${encodeURIComponent(requestId)}`
// The bundle bytes. Device-only like the roster: this is an owner surface, not a task surface, so a
// task-scoped internal token can't reach it (server/index.ts mounts requireDevice over both forms).
export const corePluginBundleRoute = (id: string) => `/v2/core/plugins/${encodeURIComponent(id)}/client.js`
// Every client paired with a node, and the revoke for one of them. Device-only, like the plugin list:
// this is node administration.
export const coreDevicesRoute = '/v2/core/devices'
export const coreDeviceRoute = (deviceId: string) => `/v2/core/devices/${encodeURIComponent(deviceId)}`

// Settings → Security (docs/security.md § Audit, § Filesystem and backup).
//
// `diskEncrypted` is three-valued. `null` means "this node can't tell", the honest answer off macOS,
// where LUKS, dm-crypt, ZFS native encryption and a dozen NAS arrangements all count. A security
// warning that cries wolf is worse than no warning.
export type NodeSecurityPosture = { diskEncrypted: boolean | null; platform: string }
export const coreSecurityRoute = '/v2/core/security'
// Settings → Security → 1Password: is the `op` CLI runnable on this node, and forget what it cached.
export const coreOnePasswordRoute = '/v2/core/secrets/onepassword'

// Settings → Nodes: who this node is attached to, and the button that drops it
// (docs/node-enrollment.md § Detaching). Device-only, like devices and plugins: an attachment is
// node administration, and detaching revokes a credential.
//
// `attachment` is null on every node that never enrolled, which is the default and the majority.
// `error` is the last failed enrollment, kept so a provisioned node that could not reach its control
// plane says so instead of looking ordinary.
export type NodeAttachmentState = {
  attachment: NodeAttachment | null
  error: { at: number; reason: string } | null
}
export const coreAttachmentRoute = '/v2/core/attachment'

// Nodes this node's plugins know about (docs/plugins.md § Node providers). The client fans this out
// over every reachable node and unions the answers, so a provider running on one node is visible from
// a client sitting at another.
//
// `enrollment.deviceToken` is deliberately absent from this projection. The adopt route below is the
// only way to get one, it answers the host rather than the renderer, and that keeps "a device token
// never reaches the renderer" true for the second door as well as the first.
export const coreNodeProvidersRoute = '/v2/core/nodes'
export const coreNodeAdoptRoute = '/v2/core/nodes/adopt'
export const coreNodeLifecycleRoute = (verb: 'create' | 'destroy' | 'start' | 'stop') => `/v2/core/nodes/${verb}`

// The append-only audit trail. `details` is an allowlisted bag of scalars chosen per action: never a
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
// One plugin-declared verb, qualified `<pluginId>:<actionId>` by the node. Core's own verbs are a
// closed union the client already knows; this is the half that arrives from parsed manifests, which is
// what keeps the vocabulary enumerable now that a plugin can write to the trail.
export type AuditVocabularyEntry = { action: string; label: string }
// `nextBefore` is a timestamp cursor, not an offset. Rows are only appended and pruned from the far
// end, so an offset would skip or repeat entries whenever the 90-day prune ran under a paging reader.
//
// `vocabulary` rides on every page rather than taking a route of its own: its only reader is the list
// beside it, the two are always fetched together, and it is a few dozen short strings. Optional on the
// wire because an older node's page will not carry it.
export type AuditPage = { entries: AuditEntry[]; nextBefore: number | null; vocabulary?: AuditVocabularyEntry[] }
export const coreAuditRoute = '/v2/core/audit'

// `POST /v2/core/backup` (docs/data-layer.md § Backup). `destPath` is a path on the node's filesystem,
// which is why the client offers a native save dialog only for the local node. `excluded` is echoed
// back and written into the archive's manifest, so "why is my GitHub token gone" is answered for
// whoever restores it a year later.
export type BackupResult = { path: string; bytes: number; files: string[]; excluded: string[] }
export type BackupSuggestion = { suggestedPath: string }
export const coreBackupRoute = '/v2/core/backup'

// Schedules: periodic work owned by the node (docs/schedules.md). The row and cadence types live in
// ./schedules.ts, which needs zod for the cadence parser. This module does not carry that dependency.
//
// A key contains a colon ('core:audit-prune'), so every builder below encodes it.
export const schedulesRoute = '/v2/core/schedules'
export const scheduleRoute = (key: string) => `${schedulesRoute}/${encodeURIComponent(key)}`
export const scheduleRunNowRoute = (key: string) => `${scheduleRoute(key)}/run`
export const scheduleRunsRoute = (key: string) => `${scheduleRoute(key)}/runs`
/** What this node can actually run, for the creation picker. Only what resolves is offered, so a
 *  schedule can never be created against something that does not exist. */
export const scheduleTargetsRoute = `${schedulesRoute}/targets`
/** Re-take consent after a target's declared risk tier rose. The client can't name a tier here: it
 *  posts nothing and the node re-stamps from the registry, so accepting is always accepting the tier
 *  the host just showed. */
export const scheduleConfirmRoute = (key: string) => `${scheduleRoute(key)}/confirm`

// Dashboards: the measure series behind a stat's trend (docs/dashboards.md § Trends). Read-only by
// design, not by phase: the sampler and the store share a process, so the only writer is the
// `core:sample-measures` schedule and a write route would have nobody to serve.
//
// An empty series answers 200 with an empty array, never 404. Absence is data, and a panel given a
// trend a minute ago has a cold state to render rather than an error to branch on.
export const dashboardHistoryRoute = '/v2/core/dashboards/history'
export type DashboardMeasureSample = { bucket: number; value: number }
export type DashboardHistoryResponse = { signature: string; samples: DashboardMeasureSample[] }

// Workspaces (named groups of Projects): the top-level unit.
export const workspacesRoute = '/v2/core/workspaces'
export const workspaceRoute = (id: string) => `/v2/core/workspaces/${id}`
export const workspaceBootstrapRoute = '/v2/core/workspaces/bootstrap'
export const workspaceExternalProjectsRoute = (id: string) => `/v2/core/workspaces/${id}/external-projects`
// Tasks (Project -> Task units of work): rail rows.
export const tasksRoute = '/v2/core/tasks'
export const taskRoute = (id: string) => `/v2/core/tasks/${id}`
export const taskLinksRoute = (id: string) => `/v2/core/tasks/${id}/links`
export const integrationsRoute = '/v2/core/integrations'
export const integrationRoute = (id: string) => `/v2/core/integrations/${id}`
export const integrationTestRoute = (id: string) => `/v2/core/integrations/${id}/test`
export const integrationProjectsRoute = (id: string) => `/v2/core/integrations/${id}/projects`
export const integrationMappingsRoute = (id: string) => `/v2/core/integrations/${id}/mappings`
// The read half of the model seam: every backend a Generate control can spend, which is every
// connected key plus every agent CLI installed on this machine (./modelProviders.ts § ModelBackend).
// Device-only. A plugin frame reads its own plugin's proxy route instead, because `/v2/core/*` has no
// bridge scope (docs/integrations.md § Model providers).
export const modelBackendsRoute = '/v2/core/models/backends'

export const prefsKey = ['prefs'] as const
// The suffixes identify the current response shapes and stop unrelated query data sharing keys.
export const workspacesKey = ['workspaces', 'groups', 'v2'] as const
// The `v2` suffix identifies the current task response shape, including its required `icon` field.
export const projectsKey = ['projects', 'v2'] as const
// v3 removes the legacy repo pair and makes projectId/github/nullable branch explicit.
export const tasksKey = ['tasks', 'v3'] as const
// v3 adds descriptor metadata and normalized connection summaries. A distinct key stops a persisted v2
// `{ provider, connected }` row from hiding registry-driven sources and settings.
export const integrationsKey = ['integrations', 'v3'] as const
// The backends list. New in plugin API major 11, so there is no earlier shape a persisted snapshot
// could be holding under this key; the suffix is here so the next change to the response has somewhere
// to move (the persisted query cache has no other buster).
export const modelBackendsKey = ['model-backends', 'v1'] as const
