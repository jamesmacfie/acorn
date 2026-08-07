import { blob, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// CORE's schema — what is left after Phase 2 moved every plugin's tables into its own SQLite file
// (docs/vNext/data.md § Core DB / § Plugin DBs). Edit here, then `pnpm db:generate` → `pnpm db:migrate`.
//
// What core still owns, and why each is core's rather than some plugin's:
//   - device identity (`devices`, `idempotency`) — the auth root; every plugin sits behind it.
//   - the workspace/task model (`workspaces`, `workspace_repos`, `ignored_repos`, `repo_paths`,
//     `tasks`, `task_links`, `config_acks`, `workspace_projects`) — the nouns every plugin addresses by
//     id and dereferences through CoreServices.tasks / .repos.
//   - the connection registry (`integrations`) and the generic external-item read model it keys
//     (`issues`, `issue_resources`, and the `provider:%` half of `sync_state`) — shared by two provider
//     plugins, so owned by neither; see server/integrations/itemStore.ts for the full argument.
//   - `prefs` — node-scoped preferences, read by core and by plugins through CoreServices.prefs.
//
// This file no longer describes any GitHub data. It used to be titled "the read-model mirror", which is
// now plugins/github/src/node/schema.ts.

// The thirteen GitHub tables moved to plugins/github/src/node/schema.ts in Phase 2
// (docs/vNext/data.md § Plugin DBs): the mirror (`repos`, `pull_requests`, `pr_files`, `reviews`,
// `comments`, `pr_commits`, `review_threads`, `pr_labels`, `review_requests`, `checks`), its
// collection-level freshness table (`sync_state`), and the two app-state tables keyed by a GitHub repo
// id (`viewed_files`, `pinned_repos`). Core keeps the generated DROP TABLE migration rather than
// resetting its chain — see docs/vNext/phase2-notes.md.
//
// `sync_state` is the one that changed SHAPE rather than just address, and it is worth recording. It was
// a single table with two unrelated key spaces in it: github's `repos` / `pulls:…` / `pr:…` / `files:…`
// beside the integration providers' `provider:<id>:<connection>:…`. Only convention kept them apart.
// github's keys went with the table; the provider markers stayed in CORE, as the `sync_state` table
// below, because they are read and written beside `issues` / `issue_resources` — which are core's for the
// reasons set out in server/integrations/itemStore.ts — and because db/cascade.ts evicts them in the same
// transaction as the integration row they belong to.
//
// Three core readers of the github mirror went with it, each becoming a capability the plugin publishes
// rather than a core-side query (plugins/github/src/contract/):
//   - the `pr` context section (server/agentTools/contextSections.ts) now takes an injected source, the
//     same way `notes` and `memory` already did;
//   - `main/storageFootprint.ts` counts only what core still owns and asks each plugin for its own;
//   - `apps/node/src/wiring/workflowWiring.ts`'s `failingChecksFor` is `github.mirror.failingChecks`, and
//     that file is deleted.

// Collection-level revalidation bookkeeping for INTEGRATION PROVIDER resources only (docs/caching.md).
// Keyed by (userId, resource) with the `provider:<providerId>:<connectionId>:…` shape that cascade.ts
// matches to evict a disconnected integration's markers. Reached by a plugin exclusively through
// `ExternalItemStore.readMarker` / `writeMarker`, never as a table.
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
    // fallback layer beneath a committed .acorn/config.toml (loadRepoConfig precedence). They were
    // per-workspace columns until repo-level-settings moved them here — a workspace is a GROUP of
    // repos, but these describe how to build/run/inspect ONE repo, so they belong per (owner, repo).
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

// A Workspace is a named GROUP of repos (docs/workspaces-and-tasks.md) — "Runn", "Acorn". The top-level unit
// the user selects in the top bar. Machine-scoped like repo_paths / tasks (single-user machine).
// A repo belongs to exactly one workspace (partition) — see workspaceRepos.
// PURE GROUPING: identity (name/icon/color/sort) + membership + external-project links only. The
// build/run/db/preview config that used to live here moved to repo_paths (repo-level-settings) —
// those describe a repo, not the group.
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

// External projects (Linear/Rollbar/…) linked to a workspace. One project → many repos falls out of
// the workspace grouping (the project backs every repo in the workspace). `integrationId` records
// WHICH connection the project belongs to, so a workspace can link projects across several
// integrations (docs/workspaces-and-tasks.md). Provider-agnostic — generalizes the old
// `workspace_linear_projects` / per-repo prefs key `linear:projects:{owner}/{repo}`.
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

// `db_saved_queries` moved to plugins/database/src/node/schema.ts (docs/vNext/data.md § Plugin DBs).

// `memories` (and its hand-written `memories_fts` virtual table) moved to
// plugins/memory/src/node/schema.ts (docs/vNext/data.md § Plugin DBs).

// `terminal_sessions` moved to plugins/terminal/src/node/schema.ts (docs/vNext/data.md § Plugin DBs).

// The ten `agent_*` tables (agent_sessions, agent_turns, agent_events, agent_requests,
// agent_attachments, agent_attachment_refs, agent_artifacts, agent_operations, agent_webhooks,
// agent_webhook_deliveries) moved to plugins/agents/src/node/schema.ts in Phase 2
// (docs/vNext/data.md § Plugin DBs), along with the hand-written `agent_events_fts` virtual table and
// its three triggers. drizzle-kit models neither, so the DROPs for those four objects are hand-added
// to the generated migration in this chain — exactly as `memories_fts` was.
//
// These were the only tables in the codebase a plugin genuinely JOINED against core's: three queries
// answering "sessions in workspace X" ran `agent_sessions ⋈ tasks ⋈ workspace_repos`. They are now an
// id round trip through `CoreServices.tasks.idsForWorkspace()`.

// `workflow_runs` and `workflow_steps` moved to plugins/workflows/src/node/schema.ts in Phase 2
// (docs/vNext/data.md § Plugin DBs). They are the workflow engine's durable checkpoint and nothing
// outside that plugin ever read them; `workflow_steps.task_id`/`agent_session_id` were always plain
// IDs across what are now database files, never joins. Core keeps the generated DROP TABLE migration
// rather than resetting its 42-file chain — see docs/vNext/phase2-notes.md.

// Per-user cache of fetched external issues (generic across providers, parallels integrations).
// Keyed by `integrationId` so the same identifier fetched via two different connections doesn't
// collide. Mirror table: serve-then-revalidate by TTL. Single JSON `data` column so a provider's
// issue shape can evolve without migrations.
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

// `http_requests` and `http_variables` moved to plugins/http/src/node/schema.ts
// (docs/vNext/data.md § Plugin DBs).

// --- Device identity: the vNext auth root (docs/vNext/protocol.md § Pairing) ---

// One row per paired client. Every paired device has full owner authority — a disclosed product
// decision (docs/vNext/security.md § Threat model), so there are no scopes and no per-device
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

// Idempotency replay (docs/vNext/protocol.md § HTTP conventions). Stores (deviceId, key) → request
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

// Append-only record of security-relevant actions (docs/vNext/security.md § Audit, data.md § Core DB).
// Promised since the specs were written and empty until Phase 5.
//
// What it is FOR, which decides its shape: an owner asking "what happened to this node?" after finding
// a device they do not recognise, a credential they did not connect, or a plugin they did not disable.
// It is not a debugging log and not an intrusion-detection feed.
//
// Deliberately NOT tamper-evident. security.md says so outright — hash chains defend against an attacker
// who already owns the DB file, and a compromised machine is out of scope. Adding them would be
// ceremony that changes no outcome.
//
// `details` is JSON of allowlisted scalars only, decided at each call site. Never a request body, never
// a credential, never a file's contents — an audit trail that quotes what it saw becomes a second copy
// of the thing it was protecting.
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
