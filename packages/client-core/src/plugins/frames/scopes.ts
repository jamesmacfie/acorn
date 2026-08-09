// Which node routes a sandboxed plugin frame may reach, and under which declared scope
// (docs/plugins.md).
//
// This is the choke point. A frame has no token, no origin and no network — every call it makes is a
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
// they write `setup_script`, `dev_script`, `teardown_script` and `db_url_script` — shell commands the
// Node executes on the next task. A bridge that mapped them would let a frame with no network and no
// token achieve arbitrary code execution on the Node by writing a script and waiting.

// The plugin route namespace, spelled out here rather than imported. node-core owns the constant
// (server/routeRegistry.ts) and the client may not import node code; @acorn/protocol is not an option
// either — an architecture rule forbids protocol from naming a plugin route at all, on the grounds
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
    note: 'GET reads setup/dev/teardown/db-url scripts, which frequently carry credentials. PUT writes those scripts for the Node to execute and is permanently unmappable (main/repoConfigTrust.ts).',
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
    note: 'Every workspace mutation is unmappable — a workspace is the top-level unit a user organises by hand.',
  },
  { path: shape(`/v2/core/workspaces/${SEG}/external-projects`), scopes: { GET: 'core.workspaces:read' } },

  // ── Permanently unmappable ──────────────────────────────────────────────────────────────────────
  // Node administration and owner surfaces. Nothing here has a read a plugin needs, and several would
  // hand over credentials or a way to run code.
  { path: shape('/v2/core/security'), scopes: {}, note: 'Node security posture; owner surface.' },
  { path: shape('/v2/core/audit'), scopes: {}, note: 'The audit trail must not be readable by the code it audits.' },
  { path: shape('/v2/core/backup'), scopes: {}, note: 'Writes an archive to a path on the Node.' },
  { path: shape('/v2/core/devices'), scopes: {}, note: 'Pairing administration.' },
  { path: shape(`/v2/core/devices/${SEG}`), scopes: {} },
  { path: shape('/v2/core/plugins'), scopes: {}, note: 'Which code a device runs is an owner decision, not a plugin one.' },
  { path: shape(`/v2/core/plugins/${SEG}/client.js`), scopes: {}, note: 'Another plugin’s bundle bytes.' },
  // Permanently unmapped, and the sharpest case in this table. A frame that could reach these would let
  // a sandboxed plugin fetch and install arbitrary code that runs unsandboxed inside the node — every
  // other line here would stop mattering (docs/security.md).
  { path: shape('/v2/core/plugins/install'), scopes: {}, note: 'Installs code that runs with the Node’s own access.' },
  { path: shape(`/v2/core/plugins/${SEG}/update`), scopes: {} },
  { path: shape(`/v2/core/plugins/${SEG}`), scopes: {}, note: 'Uninstall, including the option to delete another plugin’s data.' },
  { path: shape('/v2/core/prefs'), scopes: {}, note: 'Every preference on the node, including other plugins’ persisted state. Frames get their own namespaced `state` verb instead.' },
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
]

export type ApiDecision = { allowed: true } | { allowed: false; reason: string }

const DENY = (reason: string): ApiDecision => ({ allowed: false, reason })

// The path a rule is matched against: query string dropped, since no rule keys off one and a `?` is
// never part of a route's identity.
const pathOnly = (path: string): string => path.split(/[?#]/, 1)[0]

/**
 * Is this frame allowed to make this call? `api` is the plugin's manifest-declared scope list, read by
 * the host from disk — never anything the frame sent.
 */
export function allowApi(
  binding: { pluginId: string; api: readonly string[] },
  method: string,
  path: string,
): ApiDecision {
  if (!isApiMethod(method)) return DENY(`unsupported method ${method}`)

  // Shape first. A path that is not an absolute node path is not a path we can classify at all — and a
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

/** Every scope name the table can grant. The trust dialog and the docs read from this, not a copy. */
export const GRANTABLE_SCOPES: readonly string[] = [
  ...new Set(RULES.flatMap((rule) => Object.values(rule.scopes))),
].sort()

// Consent copy for every scope this table can grant. These strings are also update-diff keys, so keep
// them stable: changing copy marks the line as newly requested on the next plugin update.
const SCOPE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  'core.projects:config': 'Read every project’s build, dev and database scripts',
  'core.projects:read': 'Read projects, including where every codebase lives on disk',
  'core.projects:write': 'Create and update projects, including their on-disk locations',
  'core.tasks:read': 'Read tasks',
  'core.tasks:write': 'Create and update tasks',
  'core.workspaces:read': 'Read workspaces',
}

export const describeScope = (scope: string): string | undefined => SCOPE_DESCRIPTIONS[scope]
