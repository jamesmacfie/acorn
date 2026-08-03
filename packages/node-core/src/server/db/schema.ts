import { blob, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// The read-model mirror + app-state schema (docs/data-layer.md). Mirror tables are cached,
// revalidated projections of GitHub data; app-state tables (prefs, pins, viewed files) are the
// source of truth. Edit here, then `pnpm db:generate` → `pnpm db:migrate`.

// --- Mirror tables: cached projections of GitHub data (revalidated, disposable) ---

export const repos = sqliteTable(
  'repos',
  {
    // Private repos are user-scoped (docs/data-layer.md): two users may mirror the same
    // private repo, so (userId, id) is the key — id alone (the GitHub repo id) isn't unique.
    userId: text('user_id').notNull(),
    id: integer('id').notNull(), // GitHub repo id
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    private: integer('private', { mode: 'boolean' }).notNull().default(false),
    defaultBranch: text('default_branch'),
    pushedAt: integer('pushed_at'), // epoch ms — repo selector orders by this
    // Staleness is fetchedAt + a route constant (REPOS_STALE_AFTER_MS); list ETags live in sync_state.
    fetchedAt: integer('fetched_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
)

export const pullRequests = sqliteTable(
  'pull_requests',
  {
    // User-scoped like repos: a private repo's PR mirror must never serve across users.
    userId: text('user_id').notNull(),
    repoId: integer('repo_id').notNull(),
    number: integer('number').notNull(),
    nodeId: text('node_id'), // GraphQL node id — needed for draft↔ready toggles
    state: text('state').notNull(), // open | closed | merged
    draft: integer('draft', { mode: 'boolean' }).notNull().default(false),
    title: text('title').notNull(),
    body: text('body'), // sanitized bodyHTML from GraphQL (rendered via innerHTML)
    headSha: text('head_sha'), // head commit oid — commit_id for creating line comments
    headRef: text('head_ref'),
    baseRef: text('base_ref'),
    author: text('author'),
    updatedAt: integer('updated_at'),
    mergeable: text('mergeable'), // MERGEABLE | CONFLICTING | UNKNOWN
    mergeStateStatus: text('merge_state_status'), // CLEAN | BLOCKED | BEHIND | DIRTY | DRAFT | UNSTABLE | UNKNOWN
    autoMergeEnabled: integer('auto_merge_enabled', { mode: 'boolean' }).notNull().default(false),
    // Staleness is fetchedAt + a route constant; the list ETag lives in sync_state (no per-row home).
    fetchedAt: integer('fetched_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.repoId, t.number] }),
    index('pull_requests_user_repo_state_updated_idx').on(t.userId, t.repoId, t.state, t.updatedAt),
  ],
)

// --- PR-detail children: mirrored together from the GraphQL composite, replaced wholesale on
// each sync. No per-row staleness — freshness is governed by sync_state(`pr:<repoId>:<number>`).
// All user-scoped and keyed off the PR (userId, repoId, number) + a per-row discriminator.

export const prFiles = sqliteTable(
  'pr_files',
  {
    userId: text('user_id').notNull(),
    repoId: integer('repo_id').notNull(),
    number: integer('number').notNull(),
    path: text('path').notNull(),
    status: text('status'), // changeType / GitHub status: added | modified | removed | renamed | …
    additions: integer('additions'),
    deletions: integer('deletions'),
    sha: text('sha'), // blob sha — patch bodies live in the on-disk BLOBS cache keyed by this (docs/caching.md)
  },
  (t) => [primaryKey({ columns: [t.userId, t.repoId, t.number, t.path] })],
)

export const reviews = sqliteTable(
  'reviews',
  {
    userId: text('user_id').notNull(),
    repoId: integer('repo_id').notNull(),
    number: integer('number').notNull(),
    id: text('id').notNull(), // GraphQL node id
    author: text('author'),
    state: text('state'), // APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED | PENDING
    body: text('body'),
    submittedAt: integer('submitted_at'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.repoId, t.number, t.id] })],
)

export const comments = sqliteTable(
  'comments',
  {
    userId: text('user_id').notNull(),
    repoId: integer('repo_id').notNull(),
    number: integer('number').notNull(),
    id: text('id').notNull(), // GraphQL node id
    author: text('author'),
    body: text('body'),
    createdAt: integer('created_at'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.repoId, t.number, t.id] })],
)

export const prCommits = sqliteTable(
  'pr_commits',
  {
    userId: text('user_id').notNull(),
    repoId: integer('repo_id').notNull(),
    number: integer('number').notNull(),
    sha: text('sha').notNull(),
    message: text('message').notNull(),
    author: text('author'),
    authorLogin: text('author_login'),
    committedAt: integer('committed_at'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.repoId, t.number, t.sha] })],
)

// Inline review-comment threads. One row per comment; thread-level fields (path/line/side/
// resolved) are denormalized onto each row. databaseId is the numeric id REST needs for replies.
export const reviewThreads = sqliteTable(
  'review_threads',
  {
    userId: text('user_id').notNull(),
    repoId: integer('repo_id').notNull(),
    number: integer('number').notNull(),
    threadId: text('thread_id').notNull(),
    id: text('id').notNull(), // comment node id
    databaseId: integer('database_id'),
    path: text('path'),
    line: integer('line'),
    side: text('side'), // RIGHT | LEFT
    resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
    author: text('author'),
    body: text('body'),
    createdAt: integer('created_at'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.repoId, t.number, t.id] })],
)

export const prLabels = sqliteTable(
  'pr_labels',
  {
    userId: text('user_id').notNull(),
    repoId: integer('repo_id').notNull(),
    number: integer('number').notNull(),
    name: text('name').notNull(),
    color: text('color'), // 6-hex, no leading #
  },
  (t) => [primaryKey({ columns: [t.userId, t.repoId, t.number, t.name] })],
)

// Pending review requests (logins). ponytail: users only — team review requests not mirrored.
export const reviewRequests = sqliteTable(
  'review_requests',
  {
    userId: text('user_id').notNull(),
    repoId: integer('repo_id').notNull(),
    number: integer('number').notNull(),
    login: text('login').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.repoId, t.number, t.login] })],
)

export const checks = sqliteTable(
  'checks',
  {
    userId: text('user_id').notNull(),
    repoId: integer('repo_id').notNull(),
    number: integer('number').notNull(),
    name: text('name').notNull(), // CheckRun.name | StatusContext.context
    status: text('status'), // CheckRun.conclusion|status | StatusContext.state
    url: text('url'),
    runId: integer('run_id'), // CheckRun.checkSuite.workflowRun.databaseId — null for StatusContext; enables rerun-failed-jobs
  },
  (t) => [primaryKey({ columns: [t.userId, t.repoId, t.number, t.name] })],
)

// Collection-level revalidation bookkeeping: a list endpoint's ETag has no per-row home
// (docs/caching.md). Keyed by (userId, resource) e.g. `pulls:<repoId>:open`, `pr:<repoId>:<number>`.
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
// user_id on prefs / pinned_repos / viewed_files is the SINGLE canonical user id: the
// authenticated GitHub login (auth middleware's user.login). This is a single-user app, so the
// column isn't multi-tenancy — it just pins app state to the GitHub identity so a login switch
// doesn't inherit another account's state. Newer app-state tables (tasks, repo_paths, …) are
// machine-scoped and drop it.

// Per-user "I've reviewed this file" checkboxes. Survives mirror re-syncs (not a GitHub concept).
export const viewedFiles = sqliteTable(
  'viewed_files',
  {
    userId: text('user_id').notNull(),
    repoId: integer('repo_id').notNull(),
    number: integer('number').notNull(),
    path: text('path').notNull(),
    viewedAt: integer('viewed_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.repoId, t.number, t.path] })],
)

// Per-user pinned repos for the selector (sort ascending).
export const pinnedRepos = sqliteTable(
  'pinned_repos',
  {
    userId: text('user_id').notNull(),
    repoId: integer('repo_id').notNull(),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.repoId] })],
)

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

// Durable terminal sessions (docs/workflows.md). Machine-scoped like repo_paths. We persist ONLY tmux-backed
// sessions: tmux outlives an app restart, so on startup the service reconciles these rows against
// `tmux list-sessions` and re-attaches the survivors. node-pty sessions die with the process and
// live only in the in-memory map. No terminal output is ever stored (docs/terminal-and-agents.md). ponytail: a §7
// subset — no pid / last_attached_at (we re-derive liveness from tmux, not a stored pid).
// Bound to a task (docs/workspaces-and-tasks.md/03): repo / branch / PR are derived through the
// taskId → tasks join, so the loose repo_owner / repo_name / pull_number columns are gone.
export const terminalSessions = sqliteTable(
  'terminal_sessions',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    kind: text('kind').notNull(), // shell | agent
    profileId: text('profile_id').notNull(),
    backend: text('backend').notNull(), // node-pty | tmux (only tmux rows are persisted)
    status: text('status').notNull(), // running | exited
    cwd: text('cwd').notNull(),
    taskId: text('task_id').notNull(), // → tasks.id
    command: text('command').notNull(),
    argvJson: text('argv_json').notNull().default('[]'),
    tmuxSession: text('tmux_session'),
    cols: integer('cols').notNull(),
    rows: integer('rows').notNull(),
    agentSessionId: text('agent_session_id'), // managed-agent handoff/tool-terminal lineage
    createdAt: integer('created_at').notNull(),
    exitedAt: integer('exited_at'),
    exitCode: integer('exit_code'),
  },
  (t) => [
    index('terminal_sessions_task_idx').on(t.taskId),
    index('terminal_sessions_agent_session_idx').on(t.agentSessionId),
  ],
)

// Managed agent sessions are task-scoped execution records. Provider-specific resumability remains
// provider-owned (`providerSessionRef`); Acorn owns the normalized local transcript and projections.
export const agentSessions = sqliteTable(
  'agent_sessions',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(),
    providerId: text('provider_id').notNull(),
    profileId: text('profile_id').notNull(),
    kind: text('kind').notNull(), // interactive | workflow | imported
    driverKind: text('driver_kind').notNull(),
    driverVersion: text('driver_version').notNull(),
    providerSessionRef: text('provider_session_ref'),
    controller: text('controller').notNull().default('acorn'), // acorn | terminal | external
    runtimeState: text('runtime_state').notNull(), // core/shared/managedAgents.ts
    attention: text('attention').notNull().default('none'),
    statusAuthority: text('status_authority').notNull(),
    title: text('title').notNull(),
    model: text('model'),
    configJson: text('config_json').notNull().default('{}'),
    parentSessionId: text('parent_session_id'),
    parentTurnId: text('parent_turn_id'),
    lastEventSeq: integer('last_event_seq').notNull().default(0),
    lastReadSeq: integer('last_read_seq').notNull().default(0),
    archivedAt: integer('archived_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('agent_sessions_task_updated_idx').on(t.taskId, t.updatedAt),
    index('agent_sessions_attention_updated_idx').on(t.attention, t.updatedAt),
    index('agent_sessions_provider_ref_idx').on(t.providerId, t.providerSessionRef),
    index('agent_sessions_parent_idx').on(t.parentSessionId),
  ],
)

// A durable queue entry and the canonical turn projection. One active turn per session is enforced
// by the service scheduler because SQLite partial uniqueness would be awkward in Drizzle.
export const agentTurns = sqliteTable(
  'agent_turns',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    source: text('source').notNull(), // interactive | workflow | automation | import
    status: text('status').notNull(), // queued | dispatching | active | completed | cancelled | failed | interrupted
    inputJson: text('input_json').notNull(),
    effectivePolicyJson: text('effective_policy_json').notNull().default('{}'),
    providerTurnRef: text('provider_turn_ref'),
    stopReason: text('stop_reason'),
    usageJson: text('usage_json'),
    errorJson: text('error_json'),
    idempotencyKey: text('idempotency_key').notNull(),
    attempt: integer('attempt').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    startedAt: integer('started_at'),
    completedAt: integer('completed_at'),
  },
  (t) => [
    uniqueIndex('agent_turns_session_ordinal_idx').on(t.sessionId, t.ordinal),
    uniqueIndex('agent_turns_session_idempotency_idx').on(t.sessionId, t.idempotencyKey),
    index('agent_turns_session_status_idx').on(t.sessionId, t.status),
  ],
)

// Append-only normalized event ledger. `searchText` feeds the migration-owned FTS5 virtual table;
// large bytes and verbose command output live in agent_artifacts instead of this row.
export const agentEvents = sqliteTable(
  'agent_events',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    turnId: text('turn_id'),
    seq: integer('seq').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    eventJson: text('event_json').notNull(),
    searchText: text('search_text'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('agent_events_session_seq_idx').on(t.sessionId, t.seq),
    index('agent_events_turn_seq_idx').on(t.turnId, t.seq),
    index('agent_events_created_idx').on(t.createdAt),
  ],
)

export const agentRequests = sqliteTable(
  'agent_requests',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    turnId: text('turn_id'),
    providerRequestId: text('provider_request_id').notNull(),
    kind: text('kind').notNull(), // permission | question | elicitation | workflow_gate
    // `resolving` is a durable claim made before Acorn sends a response to the provider. It closes
    // the double-submit window without pretending a response is complete before the provider acks.
    status: text('status').notNull(), // pending | resolving | resolved | expired
    title: text('title').notNull(),
    detail: text('detail'),
    payloadJson: text('payload_json').notNull().default('{}'),
    resolutionJson: text('resolution_json'),
    resolutionIdempotencyKey: text('resolution_idempotency_key'),
    expiresAt: integer('expires_at'),
    createdAt: integer('created_at').notNull(),
    resolvedAt: integer('resolved_at'),
  },
  (t) => [
    uniqueIndex('agent_requests_session_provider_idx').on(t.sessionId, t.providerRequestId),
    index('agent_requests_status_created_idx').on(t.status, t.createdAt),
  ],
)

export const agentAttachments = sqliteTable(
  'agent_attachments',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(),
    storageKey: text('storage_key').notNull(),
    contentHash: text('content_hash').notNull(),
    filename: text('filename').notNull(),
    mediaType: text('media_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    textEncoding: text('text_encoding'),
    createdAt: integer('created_at').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    uniqueIndex('agent_attachments_task_hash_idx').on(t.taskId, t.contentHash),
    index('agent_attachments_storage_idx').on(t.storageKey),
  ],
)

export const agentAttachmentRefs = sqliteTable(
  'agent_attachment_refs',
  {
    attachmentId: text('attachment_id').notNull(),
    turnId: text('turn_id').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.attachmentId, t.turnId] }),
    index('agent_attachment_refs_turn_position_idx').on(t.turnId, t.position),
  ],
)

export const agentArtifacts = sqliteTable(
  'agent_artifacts',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    turnId: text('turn_id'),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    mediaType: text('media_type'),
    storageKey: text('storage_key'),
    byteSize: integer('byte_size'),
    metadataJson: text('metadata_json').notNull().default('{}'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('agent_artifacts_session_created_idx').on(t.sessionId, t.createdAt),
    index('agent_artifacts_turn_idx').on(t.turnId),
  ],
)

// Idempotency for commands whose resource row does not naturally carry the caller key (session
// creation, lifecycle changes and public automation). Results are small, normalized JSON only.
export const agentOperations = sqliteTable(
  'agent_operations',
  {
    idempotencyKey: text('idempotency_key').primaryKey(),
    command: text('command').notNull(),
    resourceId: text('resource_id'),
    resultJson: text('result_json').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('agent_operations_created_idx').on(t.createdAt)],
)

export const agentWebhooks = sqliteTable(
  'agent_webhooks',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id'),
    url: text('url').notNull(),
    eventsJson: text('events_json').notNull(),
    secretEnc: text('secret_enc').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('agent_webhooks_task_enabled_idx').on(table.taskId, table.enabled),
  ],
)

export const agentWebhookDeliveries = sqliteTable(
  'agent_webhook_deliveries',
  {
    id: text('id').primaryKey(),
    webhookId: text('webhook_id').notNull(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(), // completion | attention
    payloadJson: text('payload_json').notNull(),
    status: text('status').notNull(), // pending | retrying | delivered | failed
    attempt: integer('attempt').notNull().default(0),
    nextAttemptAt: integer('next_attempt_at').notNull(),
    responseStatus: integer('response_status'),
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    deliveredAt: integer('delivered_at'),
  },
  (table) => [
    uniqueIndex('agent_webhook_deliveries_event_idx').on(table.webhookId, table.eventId),
    index('agent_webhook_deliveries_due_idx').on(table.status, table.nextAttemptAt),
    index('agent_webhook_deliveries_created_idx').on(table.webhookId, table.createdAt),
  ],
)

// Workflow runs (docs/workflows.md): the durable checkpoint for the main-process state machine —
// every transition is persisted so a run survives an app restart (LangGraph-style checkpoint = the
// rows; reconciliation mirrors the tmux pattern). Machine-scoped like tasks.
export const workflowRuns = sqliteTable(
  'workflow_runs',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(), // → tasks.id (the worktree/agent scope)
    name: text('name').notNull(),
    status: text('status').notNull(), // running | gated | cancelling | done | failed | safety-rail | cancelled
    posture: text('posture').notNull().default('gated'), // gated (default) | autonomous (14 §posture)
    trigger: text('trigger').notNull().default('manual'),
    defJson: text('def_json').notNull(), // the WorkflowDef this run executes (frozen at start)
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('workflow_runs_task_created_idx').on(table.taskId, table.createdAt), index('workflow_runs_status_idx').on(table.status)],
)

// One step of a run. Steps carry a FIRST-CLASS working context (worktreePath — bargain-bull's
// hardest lesson); structured output is the edge currency (branch/join material).
export const workflowSteps = sqliteTable(
  'workflow_steps',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(), // → workflow_runs.id
    idx: integer('idx').notNull(), // sequence position
    name: text('name').notNull(),
    kind: text('kind').notNull().default('agent'), // registry id; built-ins include agent/gates/ci-loop/fan-out/join/decide
    mode: text('mode').notNull().default('headless'), // headless | ai | interactive
    profileId: text('profile_id'),
    model: text('model'),
    status: text('status').notNull(), // pending | running | waiting-gate | done | failed | skipped | safety-rail | cancelled
    worktreePath: text('worktree_path'),
    inputsJson: text('inputs_json'), // the assembled bundle handed to the step
    resultJson: text('result_json'), // the captured HeadlessResult (sans events)
    structuredJson: text('structured_json'), // the schema-conforming output — the edge currency
    sessionId: text('session_id'), // for --resume (open in terminal, 15 P2)
    agentSessionId: text('agent_session_id'), // normalized managed-agent history/attention lineage
    costUsd: real('cost_usd'),
    iteration: integer('iteration').notNull().default(0), // loop bound bookkeeping (14 §loop)
    parentStepId: text('parent_step_id'), // fan-out lineage (14 P4)
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('workflow_steps_run_idx_idx').on(table.runId, table.idx),
    index('workflow_steps_parent_created_idx').on(table.parentStepId, table.createdAt),
    index('workflow_steps_agent_session_idx').on(table.agentSessionId),
  ],
)

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

// Saved HTTP requests for the API panel (docs/panes.md). Repo-scoped like db_saved_queries — a
// request written against a repo's API outlives any one task worktree. Credentials make this
// identity-scoped even on a single-user machine. Sensitive fields are JWE ciphertext whenever
// `encrypted` is true; startup migrates pre-encryption rows before opening the listener.
// The `http_` prefix, not `api_`: `api_tokens`/`api_idempotency` already belong to the public
// automation API (docs/public-api.md), and so does the settings page id `api`.
export const httpRequests = sqliteTable(
  'http_requests',
  {
    id: text('id').primaryKey(),
    // The default exists only so Drizzle can rebuild populated legacy tables. Startup claims
    // legacy rows only when exactly one GitHub identity exists; ambiguous rows stay quarantined.
    userId: text('user_id').notNull().default('__legacy_unscoped__'),
    repoOwner: text('repo_owner').notNull(),
    repoName: text('repo_name').notNull(),
    // ponytail: a slash path ('auth/login'), not a folders table with parent_id. The client splits
    // on '/' to build the tree. Renaming a folder is one UPDATE; there are no orphans or cycles to
    // handle. The one cost is that a folder can't exist while empty.
    folder: text('folder').notNull().default(''),
    // Set = an ad-hoc request living with a task (shown in that task's API pane). Null = saved in
    // the repo tree. "Save this ad-hoc request" clears taskId and sets folder + name. No FK: the
    // schema declares none anywhere, so an orphan row after a hard task delete is inert.
    taskId: text('task_id'), // → tasks.id
    name: text('name').notNull(),
    method: text('method').notNull(),
    url: text('url').notNull(), // encrypted raw URL; holds the query string too
    headers: text('headers').notNull().default('[]'), // encrypted JSON KeyValue[]
    bodyMode: text('body_mode').notNull().default('none'), // 'none' | 'json' | 'text' | 'form'
    body: text('body').notNull().default(''), // encrypted raw string / JSON KeyValue[]
    auth: text('auth').notNull().default('{"mode":"none"}'), // encrypted JSON AuthConfig
    // Per-request variable overrides: JSON Record<string,string>, plain values only. Secret and
    // command kinds are repo-level (http_variables) because they need the enc key and a shell.
    vars: text('vars').notNull().default('{}'), // encrypted JSON Record<string,string>
    encrypted: integer('encrypted', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('http_requests_user_repo_folder_idx').on(t.userId, t.repoOwner, t.repoName, t.folder),
    index('http_requests_user_task_idx').on(t.userId, t.taskId),
  ],
)

// Repo-level variables for the API panel. `command` values are persisted shell commands whose
// output is resolved at send time and never persisted. Every value kind is JWE ciphertext under
// SESSION_ENC_KEY; secret plaintext is additionally never sent to the renderer.
export const httpVariables = sqliteTable(
  'http_variables',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().default('__legacy_unscoped__'),
    repoOwner: text('repo_owner').notNull(),
    repoName: text('repo_name').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(), // 'value' | 'secret' | 'command'
    value: text('value').notNull(), // JWE ciphertext for plaintext value / secret / shell command
    encrypted: integer('encrypted', { mode: 'boolean' }).notNull().default(false),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('http_variables_user_repo_name_idx').on(t.userId, t.repoOwner, t.repoName, t.name)],
)

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
