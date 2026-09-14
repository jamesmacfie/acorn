// Which node routes a sandboxed plugin frame may reach, and under which declared scope
// (docs/plugins.md).
//
// This is the choke point. A frame has no token, no origin and no network. Every call it makes is a
// `path` on this table, forwarded by the broker through the host's per-node client. So the whole of
// "what can a third-party plugin do to my machine" is decided here, and the table is deliberately an
// allowlist of (path shape, method) pairs rather than a prefix match.
//
// Why not `core.tasks:read ⇒ GET /v2/core/tasks*`, which is what the phase doc sketches: that glob
// also matches `GET /v2/core/tasks/:id/mcp/starter`, which hands out an MCP configuration for the
// task, and `GET /v2/core/tasks/:id/preview-url`, which hands out a tunnel URL. Both are read-shaped
// and neither belongs to a plugin. The star was the wrong granularity; every rule below names its
// path.
//
// Three groups, and the difference between the last two is intent rather than effect:
//
//   mapped        a (path, method) a declared scope grants.
//   unmappable    a path listed here with no mapping for that method. It can never be granted, whatever
//                 a manifest declares. Listed rather than omitted so the exhaustive test can tell a
//                 decision from an oversight.
//   unknown       not on the table at all: denied, and the test fails until someone classifies it.
//
// The two project-config PUTs are the sharpest entry in the unmappable group and worth stating twice:
// they write `setup_script`, `dev_script`, `teardown_script` and `db_url_script`: shell commands the
// Node executes on the next task. A bridge that mapped them would let a frame with no network and no
// token achieve arbitrary code execution on the Node by writing a script and waiting.

// The plugin route namespace, spelled out here rather than imported. node-core owns the constant
// (server/routeRegistry.ts) and the client may not import node code; @acorn/protocol is not an option
// either. An architecture rule forbids protocol from naming a plugin route at all, on the grounds
// that plugin wire surfaces belong to the plugin.
const PLUGIN_NAMESPACE = '/v2/p/'

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

const METHODS: readonly ApiMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

export const isApiMethod = (value: unknown): value is ApiMethod =>
  typeof value === 'string' && (METHODS as readonly string[]).includes(value)

// One path shape and the scope each method on it requires. A method absent from `scopes` is
// unmappable on that path.
type RouteRule = {
  path: RegExp
  scopes: Partial<Record<ApiMethod, string>>
  // Why a dangerous method on this path is absent. Prose for the next reader, not used at runtime.
  note?: string
}

// A single path segment. Ids are opaque and percent-encoded by the route builders, so `[^/]+` is the
// right shape and a segment can never swallow a `/` and reach a sibling route.
const SEG = '[^/]+'
const shape = (pattern: string) => new RegExp(`^${pattern}$`)

// Ordered: the first rule whose path matches decides. Literal paths come before the `:id` shapes they
// would otherwise be captured by (`/workspaces/bootstrap` before `/workspaces/:id`).
const RULES: readonly RouteRule[] = [
  // ── Tasks ───────────────────────────────────────────────────────────────────────────────────────
  { path: shape('/v2/core/tasks'), scopes: { GET: 'core.tasks:read', POST: 'core.tasks:write' } },
  { path: shape('/v2/core/task-statuses'), scopes: { GET: 'core.tasks:read' } },
  {
    path: shape(`/v2/core/tasks/${SEG}`),
    scopes: { GET: 'core.tasks:read', PATCH: 'core.tasks:write' },
    note: 'DELETE is absent on the principle destruction is a confirmed, user-initiated act.',
  },
  {
    path: shape(`/v2/core/tasks/${SEG}/links`),
    scopes: { GET: 'core.tasks:read', POST: 'core.tasks:write' },
    note: 'DELETE stays absent: unlinking is a user-visible edit to task history, handled by native task UI.',
  },
  { path: shape(`/v2/core/tasks/${SEG}/context`), scopes: { GET: 'core.tasks:read' } },
  { path: shape(`/v2/core/tasks/${SEG}/archive`), scopes: { POST: 'core.tasks:write' } },
  {
    path: shape(`/v2/core/tasks/${SEG}/archive-concerns`),
    scopes: {},
    note: 'Every plugin\'s answer about archiving this task, in one list. No scope, because reading '
      + 'it would hand a frame the other installed plugins\' warnings about the owner\'s work, a '
      + 'cross-plugin read this profile refuses. The dialog that shows it is the host\'s own.',
  },

  // ── Projects ────────────────────────────────────────────────────────────────────────────────────
  { path: shape('/v2/core/projects'), scopes: { GET: 'core.projects:read', POST: 'core.projects:write' } },
  {
    path: shape(`/v2/core/projects/${SEG}`),
    scopes: { GET: 'core.projects:read', PATCH: 'core.projects:write' },
    note: 'DELETE is a confirmed, user-initiated act.',
  },
  {
    path: shape(`/v2/core/projects/${SEG}/detect`),
    scopes: { POST: 'core.projects:write' },
    note: 'Safe by comparison with the config writes: a new or re-detected project row is inert until someone opens it, which is what makes importers workable.',
  },
  {
    path: shape(`/v2/core/projects/${SEG}/config`),
    scopes: { GET: 'core.projects:config' },
    note: 'GET reads setup/dev/teardown/db-url scripts, which frequently carry credentials. PUT writes those scripts for the Node to execute and is permanently unmappable (server/repoConfigTrust.ts).',
  },
  {
    path: shape(`/v2/core/projects/${SEG}/run-targets`),
    scopes: {},
    note: 'Same as config: run targets are commands the Node runs.',
  },

  // ── Workspaces ──────────────────────────────────────────────────────────────────────────────────
  { path: shape('/v2/core/workspaces'), scopes: { GET: 'core.workspaces:read' } },
  { path: shape('/v2/core/workspaces/bootstrap'), scopes: {}, note: 'Creates a workspace; mutation.' },
  {
    path: shape(`/v2/core/workspaces/${SEG}`),
    scopes: { GET: 'core.workspaces:read' },
    note: 'Every workspace mutation is unmappable: a workspace is the top-level unit a user organises by hand.',
  },
  { path: shape(`/v2/core/workspaces/${SEG}/external-projects`), scopes: { GET: 'core.workspaces:read' } },

  // ── Permanently unmappable ──────────────────────────────────────────────────────────────────────
  // Node administration and owner surfaces. Nothing here has a read a plugin needs, and several would
  // hand over credentials or a way to run code.
  { path: shape('/v2/core/security'), scopes: {}, note: 'Node security posture; owner surface.' },
  { path: shape('/v2/core/audit'), scopes: {}, note: 'The audit trail must not be readable by the code it audits.' },
  // Read-shaped, and still nothing a plugin frame should see: it says whether this machine can be
  // made to run `op` and unlock the owner's vault, which is reconnaissance about the credential
  // store rather than a fact about a plugin's own work.
  { path: shape('/v2/core/secrets/onepassword'), scopes: {}, note: 'Describes how this node reads credentials.' },
  { path: shape('/v2/core/secrets/onepassword/refresh'), scopes: {}, note: 'Forces the next read to prompt the owner.' },
  { path: shape('/v2/core/backup'), scopes: {}, note: 'Writes an archive to a path on the Node.' },
  // The batch route the renderer and the other runtimes post to (docs/telemetry.md § Other
  // runtimes). Unmappable, and it is a write rather than a read: everything admitted there reaches
  // every subscribed sink and a sink can post it off the machine. A frame measuring its own work
  // has `ctx.telemetry` on the bridge, which files under the plugin the host bound.
  { path: shape('/v2/core/telemetry'), scopes: {}, note: 'Anything posted here reaches every sink; a frame cannot be allowed to write into that stream.' },
  // The counters Settings draws (docs/telemetry.md § What the page shows). Unmappable because the
  // answer names every other plugin on this machine and how much each of them is producing, which
  // is a plugin roster with a load profile attached. A plugin's own numbers are its own to keep.
  { path: shape('/v2/core/telemetry/summary'), scopes: {}, note: 'Names every other owner on this node and what each produces.' },
  // Periodic work the node runs unattended (docs/schedules.md). Unmappable in both directions: reading
  // the list enumerates what this machine does while nobody is watching, and creating or resuming one is
  // a way to make code run later, which is the same primitive as an install with a delay on it. A plugin
  // that wants periodic work declares it in its manifest, where the trust dialog discloses it.
  { path: shape('/v2/core/schedules'), scopes: {}, note: 'Declaring work that runs unattended is an owner decision.' },
  { path: shape(`/v2/core/schedules/${SEG}`), scopes: {} },
  { path: shape(`/v2/core/schedules/${SEG}/run`), scopes: {} },
  { path: shape(`/v2/core/schedules/${SEG}/runs`), scopes: {} },
  // Re-taking consent after a target's risk tier rose. Sharper than its siblings, not softer: a frame
  // that could POST this would be re-arming a confirmation on the owner's behalf, which is the exact
  // act the arming rule exists to keep in a human's hands.
  { path: shape(`/v2/core/schedules/${SEG}/confirm`), scopes: {} },
  // The control plane this node is attached to (docs/node-enrollment.md). Unmappable in both
  // directions: reading it names a control plane and the device row that vouches for it, and the DELETE
  // would let a plugin frame cut a node off from whoever provisioned it.
  { path: shape('/v2/core/attachment'), scopes: {}, note: 'Attachment is owner administration; the DELETE revokes a credential.' },
  // Node providers (docs/plugins.md § Node providers). The sharpest entry added since the plugin-install
  // routes below, and for the same reason: `adopt` hands over a durable credential for another machine,
  // `create` spends the owner's money, and `destroy` is irreversible. The list is no better — it
  // enumerates the owner's infrastructure. A plugin that wants to contribute nodes does it from its node
  // half, where the owner accepted the package, never from a frame.
  { path: shape('/v2/core/nodes'), scopes: {}, note: 'Enumerates the owner’s machines.' },
  { path: shape('/v2/core/nodes/adopt'), scopes: {}, note: 'Hands over a durable credential for another machine.' },
  { path: shape('/v2/core/nodes/create'), scopes: {}, note: 'Spends money and provisions a machine.' },
  // The remaining verbs by shape rather than by name, so a fifth one added later is unmappable by
  // default instead of unclassified. `destroy` is the sharpest: irreversible, on a machine that may
  // hold the only copy of something.
  { path: shape(`/v2/core/nodes/${SEG}`), scopes: {}, note: 'Every node lifecycle verb, including destroy.' },
  { path: shape('/v2/core/devices'), scopes: {}, note: 'Pairing administration.' },
  { path: shape(`/v2/core/devices/${SEG}`), scopes: {} },
  { path: shape('/v2/core/plugins'), scopes: {}, note: 'Which code a device runs is an owner decision, not a plugin one.' },
  { path: shape(`/v2/core/plugins/${SEG}/client.js`), scopes: {}, note: 'Another plugin’s bundle bytes.' },
  // Permanently unmapped, and the sharpest case in this table. A frame that could reach these would let
  // a sandboxed plugin fetch and install arbitrary code that runs unsandboxed inside the node. Every
  // other line here would stop mattering (docs/security.md).
  { path: shape('/v2/core/plugins/install'), scopes: {}, note: 'Installs code that runs with the Node’s own access.' },
  { path: shape(`/v2/core/plugins/${SEG}/update`), scopes: {} },
  // The one route in this family that makes code run right now rather than after a restart, which is
  // exactly why a frame must not be able to reach it: a prompt-injected agent driving a frame could
  // otherwise re-run a plugin's node half on its own timing.
  { path: shape(`/v2/core/plugins/${SEG}/reload`), scopes: {} },
  // The owner's answer to an agent's install request. Unmappable for the same reason as the three above,
  // and it is the line that keeps the approval split honest: a frame that could POST an approval would be
  // able to answer the very question that exists because an agent must not install code.
  { path: shape(`/v2/core/plugins/requests/${SEG}`), scopes: {} },
  { path: shape(`/v2/core/plugins/${SEG}`), scopes: {}, note: 'Uninstall, including the option to delete another plugin’s data.' },
  { path: shape('/v2/core/prefs'), scopes: {}, note: 'Every preference on the node, including other plugins’ persisted state. Frames get their own namespaced `state` verb instead.' },
  // The measure series behind a stat's trend. Denied for the same reason `prefs` is: a panel is composed
  // over whatever collections its owner chose, so one plugin's frame reading a panel's history is one
  // plugin reading a number derived from another's rows. The panels themselves are drawn by the host.
  { path: shape('/v2/core/dashboards/history'), scopes: {}, note: 'A panel’s measure may be derived from another plugin’s collection.' },
  { path: shape('/v2/core/agent-tools'), scopes: {}, note: 'Agent tool catalog and permissions.' },
  { path: shape(`/v2/core/tasks/${SEG}/renderer-tools/${SEG}`), scopes: {}, note: 'The renderer’s own agent-tool call surface.' },
  { path: shape(`/v2/core/tasks/${SEG}/run`), scopes: {}, note: 'Run targets are commands.' },
  { path: shape(`/v2/core/tasks/${SEG}/run/default-url`), scopes: {} },
  { path: shape(`/v2/core/tasks/${SEG}/run/${SEG}/start`), scopes: {}, note: 'Executes a command on the Node.' },
  { path: shape(`/v2/core/tasks/${SEG}/run/${SEG}/stop`), scopes: {} },
  { path: shape(`/v2/core/tasks/${SEG}/run/${SEG}/status`), scopes: {} },
  { path: shape(`/v2/core/tasks/${SEG}/config-trust`), scopes: {}, note: 'Acknowledging repo config trust is the user’s act, and the whole guard on the code-execution path.' },
  { path: shape(`/v2/core/tasks/${SEG}/preview-url`), scopes: {}, note: 'Read-shaped, but hands out a tunnel URL.' },
  { path: shape(`/v2/core/tasks/${SEG}/on-created`), scopes: {}, note: 'Runs the task setup script.' },
  { path: shape(`/v2/core/tasks/${SEG}/mcp`), scopes: {}, note: 'MCP configuration for the task.' },
  { path: shape(`/v2/core/tasks/${SEG}/mcp/starter`), scopes: {}, note: 'Read-shaped, but hands out an MCP starter configuration.' },
  { path: shape('/v2/core/integrations'), scopes: {}, note: 'Connected-account rows. Cross-plugin reads happen server-side via capabilities, never here.' },
  { path: shape(`/v2/core/integrations/${SEG}`), scopes: {} },
  { path: shape(`/v2/core/integrations/${SEG}/test`), scopes: {}, note: 'Spends another plugin’s credential.' },
  // Read-shaped and still unmappable, for both halves of the rule above it: the call spends another
  // plugin's credential on an outbound request, and what it returns is the project names inside someone
  // else's connected account. A provider reaches its own projects through its own descriptor, which is
  // where it declared them; nothing needs to read a sibling's through the bridge.
  { path: shape(`/v2/core/integrations/${SEG}/projects`), scopes: {} },
  // Which workspaces and projects follow a connection's external projects. Unmappable for the same
  // reason as the row above, plus one of its own: the write replaces the connection's whole map, so a
  // frame that reached it could quietly unfollow everything the owner had set up.
  { path: shape(`/v2/core/integrations/${SEG}/mappings`), scopes: {} },
  // Every backend a Generate control can spend. Read-shaped and ids-and-labels only, and still not
  // mappable to a scope: it is the whole roster, and minting a scope for it would hand every installed
  // plugin every connection the owner holds to serve one dropdown. A plugin that needs the list serves
  // it from its own `/v2/p/<id>` route over `ctx.core.models.available`, which is what the three
  // Generate dialogs already do (docs/integrations.md § Model providers).
  { path: shape('/v2/core/models/backends'), scopes: {}, note: 'The whole model roster. A plugin proxies its own through ctx.core.models.' },
]

export type ApiDecision = { allowed: true } | { allowed: false; reason: string }

const DENY = (reason: string): ApiDecision => ({ allowed: false, reason })

// The path a rule is matched against: query string dropped, since no rule keys off one and a `?` is
// never part of a route's identity.
const pathOnly = (path: string): string => path.split(/[?#]/, 1)[0]

/**
 * Is this frame allowed to make this call? `api` is the plugin's manifest-declared scope list, read by
 * the host from disk, never anything the frame sent.
 */
export function allowApi(
  binding: { pluginId: string; api: readonly string[] },
  method: string,
  path: string,
): ApiDecision {
  if (!isApiMethod(method)) return DENY(`unsupported method ${method}`)

  // Shape first. A path that is not an absolute node path is not a path we can classify at all, and a
  // protocol-relative `//host/x` would be a URL wearing a path's clothes.
  if (!path.startsWith('/') || path.startsWith('//')) return DENY('path must be absolute')
  const target = pathOnly(path)
  if (target.split('/').includes('..')) return DENY('path must not traverse')

  // The plugin's own namespace, always allowed: it is the plugin's own node half answering.
  const own = `${PLUGIN_NAMESPACE}${binding.pluginId}`
  if (target === own || target.startsWith(`${own}/`)) return { allowed: true }
  // Another plugin's namespace. Cross-plugin collaboration is a server-side capability, not an HTTP
  // call one plugin's UI makes into another's routes.
  if (target.startsWith(PLUGIN_NAMESPACE)) return DENY('another plugin’s namespace')

  const rule = RULES.find((candidate) => candidate.path.test(target))
  if (!rule) return DENY('route is not on the plugin bridge table')
  const scope = rule.scopes[method]
  if (!scope) return DENY(`${method} ${target} cannot be granted to a plugin`)
  if (!binding.api.includes(scope)) return DENY(`missing scope ${scope}`)
  return { allowed: true }
}

/**
 * Test seam for the exhaustive route sweep: does the table know this path at all, and what does each
 * method on it require? Returns null for a path no rule matches, which is what the sweep fails on.
 */
export function classifyPath(path: string): Partial<Record<ApiMethod, string>> | null {
  const target = pathOnly(path)
  const rule = RULES.find((candidate) => candidate.path.test(target))
  return rule ? rule.scopes : null
}

// Type-only, so it is erased and creates no runtime edge back to the module that consumes these.
import type { GrantDescription } from '../trust/permissions'

/** Every scope name the table can grant. The trust dialog and the docs read from this, not a copy. */
export const GRANTABLE_SCOPES: readonly string[] = [
  ...new Set(RULES.flatMap((rule) => Object.values(rule.scopes))),
].sort()

// Consent copy for every scope this table can grant, with how the trust prompt draws it. The severity
// and the icon live here, beside the grant, rather than being guessed back from the sentence: this
// table is the only place that knows how serious `core.projects:read` is.
//
// The copy is free to change. It used to be the update-diff key: a rewording marked the line as newly
// requested for every owner of every installed plugin. The scope name is the key now
// (plugins/permissions.ts).
const SCOPE_DESCRIPTIONS: Readonly<Record<string, GrantDescription>> = {
  'core.projects:config': { text: 'Read every project’s build, dev and database scripts', icon: 'file-cog', high: true },
  'core.projects:read': { text: 'Read projects, including where every codebase lives on disk', icon: 'folder-tree', high: true },
  'core.projects:write': { text: 'Create and update projects, including their on-disk locations', icon: 'folder-plus', high: true },
  'core.tasks:read': { text: 'Read tasks', icon: 'list' },
  'core.tasks:write': { text: 'Create and update tasks', icon: 'square-pen' },
  'core.workspaces:read': { text: 'Read workspaces', icon: 'layout-grid' },
}

export const describeScope = (scope: string): GrantDescription | undefined => SCOPE_DESCRIPTIONS[scope]
