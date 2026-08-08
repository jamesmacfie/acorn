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
// user_id on prefs is the SINGLE canonical user id: the node's opaque owner id, minted at boot
// (main/core/identity/identity.ts). Installs that predate boot-minting carry their old GitHub login as
// the value — same column, same semantics, never rewritten. Single-user app, so the column isn't
// multi-tenancy. Newer app-state tables (tasks, projects, …) are machine-scoped and drop it.

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
// GitHub token. GitHub also *appears* as a synthesized entry in the list endpoint.
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

// Machine-scoped acknowledgement of project-authored executable configuration. The hash identifies
// the exact committed config snapshot; retaining that snapshot lets the next prompt show a diff.
// Multiple hashes are kept as a small audit trail and make changing back to a previously approved
// config trusted without another prompt.
export const configAcks = sqliteTable(
  'config_acks',
  {
    // NULL means the pre-project GitHub pair had no surviving project during 0048. These rows
    // retain their bytes for recovery/audit but are deliberately inert to project trust reads.
    projectId: text('project_id'),
    hash: text('hash').notNull(), // sha256 of the repo config/workflow snapshot
    snapshot: text('snapshot').notNull(), // verbatim grouped source shown to the user
    ackedAt: integer('acked_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.hash] }), index('config_acks_project_acked_idx').on(t.projectId, t.ackedAt)],
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

// A project: a folder on this machine a workspace groups and tasks run in. The successor to the
// (owner, name)-keyed legacy tables, which were backfilled by migration 0046.
//
// The VCS and GitHub facets are nullable columns, not side tables — both are strictly 1:1 — and
// they are a CACHE of disk truth: `vcs`/`remote_url`/`default_branch` are re-detected on demand,
// never authoritative. `path` is null for a project imported from a remote (GitHub) that has not
// been cloned or mapped to a folder yet. Machine-scoped, no user_id.
export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(), // opaque uuid
    name: text('name').notNull(), // display name; defaults to basename(path) or the remote repo name
    path: text('path'), // absolute folder; null = known but not on disk yet. Uniqueness is app-enforced.
    workspaceId: text('workspace_id').notNull(), // → workspaces.id; a project lives in exactly one workspace
    sort: integer('sort').notNull().default(0),
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
    // VCS facet: 'git' when a .git entry was detected at `path`, null for a plain folder.
    vcs: text('vcs'),
    defaultBranch: text('default_branch'), // cached from origin/HEAD or the GitHub API; null when unknown
    // GitHub facet: parsed from the origin remote and/or stamped by the GitHub import flow.
    remoteUrl: text('remote_url'),
    githubOwner: text('github_owner'),
    githubName: text('github_name'),
    githubRepoId: integer('github_repo_id'),
    // Machine-local project configuration.
    runTargets: text('run_targets'),
    editorCommand: text('editor_command'),
    setupScript: text('setup_script'),
    setupScriptTrigger: text('setup_script_trigger'),
    devScript: text('dev_script'),
    devRestartScript: text('dev_restart_script'),
    teardownScript: text('teardown_script'),
    dbUrlScript: text('db_url_script'),
    dbSchemaMode: text('db_schema_mode'),
    dbSchemaValue: text('db_schema_value'),
    dbSchemaNotes: text('db_schema_notes'),
    previewMode: text('preview_mode'),
    previewValue: text('preview_value'),
    browserRules: text('browser_rules'),
    branchPrefix: text('branch_prefix'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('projects_workspace_idx').on(t.workspaceId),
    // Non-unique on purpose: two clones of one GitHub repo are legal, each its own project.
    index('projects_github_idx').on(t.githubOwner, t.githubName),
  ],
)

// External projects (Linear/Rollbar/…) linked to a workspace. One workspace can link many local projects
// workspace grouping. `integrationId` records which connection the project belongs to, so a workspace
// can link projects across several integrations (docs/workspaces-and-tasks.md).
export const workspaceExternalProjects = sqliteTable(
  'workspace_external_projects',
  {
    workspaceId: text('workspace_id').notNull(), // → workspaces.id
    integrationId: text('integration_id').notNull(), // → integrations.id
    externalId: text('external_id').notNull(), // the provider's project id within that connection
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.integrationId, t.externalId] })],
)

// A Task is the single-project unit of work (docs/workspaces-and-tasks.md/03-data-model.md): a project +
// optional branch + optional worktree + optional linked PR + its panes/terminals. Shown as a row in the rail.
// `project_id` is the authoritative owner.
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(), // opaque uuid
  title: text('title').notNull(), // editable label; seeded from origin (PR title, ticket, …)
  icon: text('icon'), // optional Lucide icon name; null = derive from origin (see ui/Icon.tsx)
  origin: text('origin').notNull(), // 'github-pr' | 'linear' | 'rollbar' | 'local'
  projectId: text('project_id').notNull(),
  branch: text('branch'), // null = run in the project root; non-null = isolated Git worktree
  worktreePath: text('worktree_path'), // null until a terminal is first opened (Flow C)
  pullNumber: integer('pull_number'), // null for local-first until a PR is inherited (Flow B)
  status: text('status').notNull(), // 'active' | 'archived' | 'cancelled' (workflow child task)
  parentId: text('parent_id'), // task tree (docs/workflows.md): set on fan-out children; null = root
  sort: integer('sort').notNull().default(0), // rail ordering
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
