import { blob, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const syncState = sqliteTable(
  'sync_state',
  {
    userId: text('user_id').notNull(),
    resource: text('resource').notNull(),
    etag: text('etag'),
    fetchedAt: integer('fetched_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.resource] })],
)

// --- App-state tables: data GitHub doesn't have, we are the source of truth ---
//
// user_id on prefs is the SINGLE canonical user id: the authenticated GitHub login (auth middleware's
// user.login). This is a single-user app, so the column isn't multi-tenancy — it just pins app state to
// the GitHub identity so a login switch doesn't inherit another account's state. Newer app-state tables
// (tasks, repo_paths, …) are machine-scoped and drop it.

export const prefs = sqliteTable(
  'prefs',
  {
    userId: text('user_id').notNull(),
    key: text('key').notNull(), // theme, diff view mode, keybinding overrides, …
    value: text('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
)

// Per-user third-party credentials. First-class, MULTI-ROW per provider (docs/workspaces-and-tasks.md): a
// user can connect several Linears / Rollbars, so the key is an opaque `id`, not (userId, provider).
// `label` disambiguates them in the UI ("Linear – work"). authRef is ENCRYPTED at rest (JWE via
// SESSION_ENC_KEY, see session.ts encryptSecret) and never leaves the server — same posture as the
// GitHub token. GitHub is the identity root — connecting it is what binds ACTIVE_IDENTITY, and userId
// is derived from it — so it also *appears* as a synthesized entry in the list endpoint.
export const integrations = sqliteTable('integrations', {
  id: text('id').primaryKey(), // opaque uuid
  userId: text('user_id').notNull(),
  provider: text('provider').notNull(), // registered provider id ('linear', 'rollbar', ...)
  label: text('label').notNull(), // user-facing name, seeded from the provider (e.g. workspace/org)
  authRef: text('access_token').notNull(), // encrypted secret material; physical name retained for migration compatibility
  authKind: text('auth_kind').notNull().default('api-key'),
  account: text('account'), // JSON ProviderAccountRef; core renders but never interprets provider ids
  scopes: text('scopes').notNull().default('[]'), // JSON string[] resolved during validation
  capabilities: text('capabilities').notNull().default('{}'), // JSON Record<string, CapabilityState>
  config: text('config').notNull().default('{}'), // provider-codec-owned, non-secret configuration
  status: text('status').notNull().default('connected'),
  lastValidatedAt: integer('last_validated_at'),
  lastError: text('last_error'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

// Local checkout for a GitHub repo (docs/workspaces-and-tasks.md). Machine-scoped, NOT user-scoped: it describes
// *this machine's* filesystem, so there's no userId — the terminal service in the Electron main
// process reads it outside any GitHub user context. PK is (owner, repo).
export const repoPaths = sqliteTable(
  'repo_paths',
  {
    owner: text('owner').notNull(),
    repo: text('repo').notNull(),
    githubRepoId: integer('github_repo_id'),
    path: text('path').notNull(),
    // Named run targets (docs/workflows.md §2): JSON RunTarget[] — the DB fallback below a committed
    // .acorn/config.toml (parsed by main/runConfig.ts legacyRunTargets). The legacy scalar
    // run_command/dev_port columns were folded into this JSON by migration 0017 and dropped in 0018.
    runTargets: text('run_targets'),
    // External editor command for this repo's worktrees (docs/workspaces-and-tasks.md): 'code' | 'zed' |
    // 'cursor -n' | an absolute path. null → the prefs 'editor_command_default' → 'code'.
    editorCommand: text('editor_command'),
    // Repo-level lifecycle/build config (docs/workspaces-and-tasks.md). These are the machine-local DB
    // fallback layer beneath a committed .acorn/config.toml (loadRepoConfig precedence). A workspace is
    // a group of repositories; these fields describe how to build, run, and inspect one repository.
    setupScript: text('setup_script'), // shell command run once when a task worktree is created; null/blank = none
    setupScriptTrigger: text('setup_script_trigger'), // 'off' | 'created' | 'terminal' — when to run it; null → 'terminal'
    devScript: text('dev_script'), // "run dev" command → a base `dev` run target; null/blank = no run button
    devRestartScript: text('dev_restart_script'), // restart command for the `dev` target; when set, run_restart runs it instead of stop+start
    teardownScript: text('teardown_script'), // shell command run in the worktree just before removal (docs/terminal-and-agents.md); null/blank = none
    dbUrlScript: text('db_url_script'), // shell command run in the worktree to print a Postgres connection URL for the Database pane (docs/pg.md); null/blank = auto-detect from .env / $DATABASE_URL
    dbSchemaMode: text('db_schema_mode'), // 'auto' | 'script' | 'file' — where the Database pane's AI-generation schema text comes from; null → 'auto' (live introspection)
    dbSchemaValue: text('db_schema_value'), // the shell command or worktree-relative file path per dbSchemaMode; null/blank = unset
    dbSchemaNotes: text('db_schema_notes'), // free-form prose sent with the schema on every AI generate: JSONB shapes, enum meanings, which tables are live; null/blank = none
    previewMode: text('preview_mode'), // 'url' | 'port' | 'script' — how the browser-preview URL is resolved; null → dev-server port
    previewValue: text('preview_value'), // the URL, port, or shell command per previewMode; null/blank = unset
    browserRules: text('browser_rules'), // JSON BrowserRule[] — preview-browser page rules (docs/panes.md); null = none
    // Prefix prepended to the branch a NEW task derives from its title, e.g. 'jamesmacfie/' →
    // 'jamesmacfie/fix-the-thing'. Stored already-normalised (slug + a trailing '/' or '-'
    // separator). DB-only like browser_rules — a naming convention is personal, not committed.
    branchPrefix: text('branch_prefix'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.owner, t.repo] })],
)

// Machine-scoped acknowledgement of repo-authored executable configuration. The hash identifies
// the exact committed config snapshot; retaining that snapshot lets the next prompt show a diff.
// Multiple hashes are kept as a small audit trail and make changing back to a previously approved
// config trusted without another prompt.
export const configAcks = sqliteTable(
  'config_acks',
  {
    repo: text('repo').notNull(), // owner/name
    hash: text('hash').notNull(), // sha256 of the repo config/workflow snapshot
    snapshot: text('snapshot').notNull(), // verbatim grouped source shown to the user
    ackedAt: integer('acked_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.repo, t.hash] }), index('config_acks_repo_acked_idx').on(t.repo, t.ackedAt)],
)

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(), // opaque uuid
  name: text('name').notNull(), // editable label
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false), // the catch-all group
  sort: integer('sort').notNull().default(0), // selector ordering
  icon: text('icon'), // JSON WorkspaceIcon ({"kind":"emoji","value":"🌰"} | {"kind":"lucide",…} | {"kind":"github"}); null → derived default
  color: text('color'), // preset token key ('green'|'blue'|…) or 6-hex; null → derived from name hash
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

// Repo → Workspace membership (partition). PK is (repoOwner, repoName): a repo lives in exactly one
// workspace. The on-disk path is NOT here — it stays in repo_paths, joined by (owner, repo).
export const workspaceRepos = sqliteTable(
  'workspace_repos',
  {
    workspaceId: text('workspace_id').notNull(), // → workspaces.id
    repoOwner: text('repo_owner').notNull(),
    repoName: text('repo_name').notNull(),
    sort: integer('sort').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.repoOwner, t.repoName] })],
)

// Repos the user has chosen to hide from workspaces (docs/workspaces-and-tasks.md). Ignoring only inserts a
// row here — the repo KEEPS its workspace_repos membership; readers filter it out of the
// selector/rail/scoping (workspaces.ts ignoredRepoSet). The onboarding modal still lists it,
// greyed under its workspace, so it can be un-ignored in place. Bootstrap skips ignored repos so
// they don't silently reappear in Default.
export const ignoredRepos = sqliteTable(
  'ignored_repos',
  {
    owner: text('owner').notNull(),
    repo: text('repo').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.owner, t.repo] })],
)

// External projects (Linear/Rollbar/…) linked to a workspace. One project → many repos follows from the
// workspace grouping. `integrationId` records which connection the project belongs to, so a workspace
// can link projects across several integrations (docs/workspaces-and-tasks.md).
export const workspaceProjects = sqliteTable(
  'workspace_projects',
  {
    workspaceId: text('workspace_id').notNull(), // → workspaces.id
    integrationId: text('integration_id').notNull(), // → integrations.id
    externalId: text('external_id').notNull(), // the provider's project id within that connection
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.integrationId, t.externalId] })],
)

// A Task is the single-repo unit of work (docs/workspaces-and-tasks.md/03-data-model.md): a repo + branch +
// optional worktree + optional linked PR + its panes/terminals. Shown as a row in the rail. Its
// parent Workspace is derived via workspaceRepos on (repoOwner, repoName). Machine-scoped — it owns
// a local worktree, so no user_id.
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(), // opaque uuid
  title: text('title').notNull(), // editable label; seeded from origin (PR title, ticket, …)
  icon: text('icon'), // optional Lucide icon name; null = derive from origin (see ui/Icon.tsx)
  origin: text('origin').notNull(), // 'github-pr' | 'linear' | 'rollbar' | 'local'
  repoOwner: text('repo_owner').notNull(), // a task always belongs to a repo
  repoName: text('repo_name').notNull(),
  branch: text('branch').notNull(), // the branch this task works on
  worktreePath: text('worktree_path'), // null until a terminal is first opened (Flow C)
  pullNumber: integer('pull_number'), // null for local-first until a PR is inherited (Flow B)
  status: text('status').notNull(), // 'active' | 'archived' | 'cancelled' (workflow child task)
  parentId: text('parent_id'), // task tree (docs/workflows.md): set on fan-out children; null = root
  sort: integer('sort').notNull().default(0), // rail ordering, like pinned_repos.sort
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  archivedAt: integer('archived_at'), // set on archive; row kept for history/teardown audit
})

// Zero-or-more external items a task references (Linear tickets, Rollbar errors). `integrationId`
// pins the item to a specific connection (two Linears could each have an `ENG-42`); `provider` is
// kept denormalized for cheap filtering. (integrationId, identifier) matches the PK tail of `issues`,
// so a link resolves straight to cached detail.
export const taskLinks = sqliteTable(
  'task_links',
  {
    taskId: text('task_id').notNull(), // → tasks.id
    integrationId: text('integration_id').notNull(), // → integrations.id
    provider: text('provider').notNull(), // 'linear' | 'rollbar' (denormalized from the integration)
    identifier: text('identifier').notNull(), // 'ENG-42' | rollbar item id
    refJson: text('ref_json'), // complete ExternalRef for providers whose locator needs more scope
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.integrationId, t.identifier] })],
)

export const issues = sqliteTable(
  'issues',
  {
    userId: text('user_id').notNull(),
    integrationId: text('integration_id').notNull(), // → integrations.id
    provider: text('provider').notNull(), // 'linear' | 'rollbar' (denormalized from the integration)
    identifier: text('identifier').notNull(), // 'ENG-123'
    data: text('data').notNull(), // JSON issue detail
    fetchedAt: integer('fetched_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.integrationId, t.identifier] })],
)

// Provider-owned child resources for an external issue. A Rollbar item, for example, has an
// independently-fresh occurrence list and individually-fetched occurrence details. Keeping those
// payloads out of `issues.data` prevents one large occurrence from evicting the item summary and
// gives the provider-resource runtime a natural freshness row per lazy tab/read.
export const issueResources = sqliteTable(
  'issue_resources',
  {
    userId: text('user_id').notNull(),
    integrationId: text('integration_id').notNull(),
    provider: text('provider').notNull(),
    issueIdentifier: text('issue_identifier').notNull(),
    resource: text('resource').notNull(),
    identifier: text('identifier').notNull(),
    data: text('data').notNull(),
    fetchedAt: integer('fetched_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.integrationId, t.issueIdentifier, t.resource, t.identifier] })],
)

// HTTP request and variable tables are owned by plugins/http (docs/data-layer.md § Plugin DBs).

// --- Device identity: the node authentication root (docs/api-reference.md § Pairing) ---

// One row per paired client. Every paired device has full owner authority — a disclosed product
// decision (docs/security.md § Threat model), so there are no scopes and no per-device
// authorization; the row exists to name a device and to be revocable.
//
// Only sha256(secret) is stored. A 256-bit random secret makes offline hash guessing infeasible, so
// nothing reversible is layered on and the plaintext is returned exactly once, at pairing.
export const devices = sqliteTable(
  'devices',
  {
    id: text('id').primaryKey(), // opaque uuid, also the public half of the token
    name: text('name').notNull(), // user-supplied ("James's laptop")
    secretHash: blob('secret_hash').notNull(), // sha256 of the token secret — never the secret
    createdAt: integer('created_at').notNull(),
    // Best-effort telemetry for the device list, written at most once per throttle window and off
    // the request path; a failed write must never fail authentication.
    lastSeenAt: integer('last_seen_at'),
    // Set once, never unset. Revocation is permanent: the row stays so the device list can show
    // what was revoked and when, and so a replayed token can never be resurrected.
    revokedAt: integer('revoked_at'),
  },
  (t) => [index('devices_revoked_idx').on(t.revokedAt)],
)

// Idempotency replay (docs/api-reference.md § HTTP conventions). Stores (deviceId, key) → request
// hash + response for 24h: the same request replays the stored response, a different request under
// the same key is a 409, and 5xx is never stored so a genuine retry re-executes.
export const idempotency = sqliteTable(
  'idempotency',
  {
    deviceId: text('device_id').notNull(),
    key: text('key').notNull(), // client-minted UUIDv7 from the Idempotency-Key header
    requestHash: text('request_hash').notNull(), // sha256(method \n path \n rawBody)
    responseStatus: integer('response_status').notNull(),
    responseBody: text('response_body').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.key] }), index('idempotency_expiry_idx').on(t.expiresAt)],
)

export const audit = sqliteTable(
  'audit',
  {
    id: text('id').primaryKey(), // uuid
    at: integer('at').notNull(),
    // WHO: 'device' is a paired client (actorId is its device id), 'internal' is a child process this
    // node spawned, 'system' is the node acting on its own behalf (boot-time decisions).
    actor: text('actor').notNull(),
    actorId: text('actor_id'),
    // WHAT, as a dotted verb from a closed set (server/audit.ts's AuditAction). A closed set rather than
    // free text because the settings surface groups and filters on it, and because an action nobody can
    // enumerate is one nobody reviews.
    action: text('action').notNull(),
    // WHICH THING: a device id, an `owner/repo`, a plugin name, a connection id. Deliberately one opaque
    // string rather than a typed reference — the rows outlive what they point at, which is the whole
    // point of keeping them after a delete.
    subject: text('subject'),
    details: text('details'),
  },
  // Every read is "the most recent N", and the 90-day prune is a range delete over the same column.
  (t) => [index('audit_at_idx').on(t.at)],
)
