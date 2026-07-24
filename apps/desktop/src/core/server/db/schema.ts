import { blob, index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
// GitHub token. GitHub itself is NOT stored here: it's the identity root (its token is the session
// cookie, userId is derived from it); it only *appears* as a synthesized entry in the list endpoint.
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
export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(), // opaque uuid
  name: text('name').notNull(), // editable label
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false), // the catch-all group
  sort: integer('sort').notNull().default(0), // selector ordering
  setupScript: text('setup_script'), // shell command run once when a task worktree is created; null/blank = none
  setupScriptTrigger: text('setup_script_trigger'), // 'off' | 'created' | 'terminal' — when to run it; null → 'terminal'
  devScript: text('dev_script'), // per-workspace "run dev" command → a `dev` run target; null/blank = no run button
  devRestartScript: text('dev_restart_script'), // per-workspace restart command for the `dev` target; when set, run_restart runs it instead of stop+start
  teardownScript: text('teardown_script'), // shell command run in the worktree just before removal (docs/terminal-and-agents.md); null/blank = none
  dbUrlScript: text('db_url_script'), // shell command run in the worktree to print a Postgres connection URL for the Database pane (docs/pg.md); null/blank = auto-detect from .env / $DATABASE_URL
  previewMode: text('preview_mode'), // 'url' | 'port' | 'script' — how the browser-preview URL is resolved; null → dev-server port
  previewValue: text('preview_value'), // the URL, port, or shell command per previewMode; null/blank = unset
  browserRules: text('browser_rules'), // JSON BrowserRule[] — preview-browser page rules (docs/panes.md); null = none
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

// Local review notes (docs/panes.md): inline annotations on UNCOMMITTED changes, sent to the
// agent as a prompt — acorn-owned app state (PR comments stay GitHub-owned). Machine-scoped like
// tasks/terminal_sessions (no user_id). THE single home for anchored annotations (README decision
// 16): when editor/browser annotations arrive, generalize the anchor (nullable anchorJson) rather
// than adding a second store. sentAt is stamped on delivery and cleared on edit (orca's pattern).
export const reviewNotes = sqliteTable('review_notes', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(), // → tasks.id
  path: text('path').notNull(), // repo-relative file
  side: text('side').notNull(), // 'additions' | 'deletions'
  startLine: integer('start_line').notNull(),
  endLine: integer('end_line').notNull(),
  snippet: text('snippet'), // the lines the note anchors to (for the prompt + re-anchoring)
  body: text('body').notNull(),
  sentAt: integer('sent_at'), // stamped on delivery; cleared on edit
  createdAt: integer('created_at').notNull(),
})

// Memory index (docs/notes-and-memory.md): markdown files are the TRUTH (<worktree>/.acorn/memory committed,
// ~/.acorn/memory private); this table is a derived index reconciled on change from all active
// worktrees + primary checkouts. id = content hash (idempotent across N checkouts); conflicts on
// (scope, repo, name) resolve newest-updatedAt. Machine-scoped. The companion FTS5 virtual table
// (memories_fts, porter stemming over name/description/body) is created by hand in the migration —
// drizzle doesn't model virtual tables.
export const memories = sqliteTable('memories', {
  id: text('id').primaryKey(), // sha256(content) prefix
  scope: text('scope').notNull(), // 'repo' | 'private'
  repo: text('repo'), // 'owner/name' for repo scope; null for private
  name: text('name').notNull(),
  type: text('type').notNull(), // convention|architecture|decision|fix|reference|feedback|task|user
  description: text('description').notNull(),
  body: text('body').notNull(),
  path: text('path').notNull(), // the winning file on disk
  originSessionId: text('origin_session_id'),
  commitSha: text('commit_sha'),
  supersededBy: text('superseded_by'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  lastAccessedAt: integer('last_accessed_at'),
  accessCount: integer('access_count').notNull().default(0),
})

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
    createdAt: integer('created_at').notNull(),
    exitedAt: integer('exited_at'),
    exitCode: integer('exit_code'),
  },
  (t) => [index('terminal_sessions_task_idx').on(t.taskId)],
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
    costUsd: real('cost_usd'),
    iteration: integer('iteration').notNull().default(0), // loop bound bookkeeping (14 §loop)
    parentStepId: text('parent_step_id'), // fan-out lineage (14 P4)
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('workflow_steps_run_idx_idx').on(table.runId, table.idx), index('workflow_steps_parent_created_idx').on(table.parentStepId, table.createdAt)],
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

// --- Public automation API (docs/public-api.md). Machine-scoped auth for the bearer-authenticated
// /api/v1 listener; distinct from the browser session cookie. ---

// Bearer API tokens (docs/public-api.md). The raw token is shown once at creation;
// only SHA-256(secret) is stored. userId links the bearer to the OAuth account at issuance (login
// switch semantics), not a tenancy boundary.
export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: text('id').primaryKey(), // opaque uuid, also the token-id segment of the bearer
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    tokenPrefix: text('token_prefix').notNull(), // short display prefix (never the secret)
    secretHash: blob('secret_hash', { mode: 'buffer' }).notNull(), // 32-byte SHA-256(secret)
    canWrite: integer('can_write', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    lastUsedAt: integer('last_used_at'), // throttled: at most once per token per 5 minutes
    expiresAt: integer('expires_at'),
    revokedAt: integer('revoked_at'), // idempotent revocation stamp
  },
  (t) => [index('api_tokens_user_created_idx').on(t.userId, t.createdAt), index('api_tokens_active_idx').on(t.id, t.revokedAt)],
)

// Encrypted upstream identity (docs/public-api.md). Persisted on every successful
// GitHub /auth/callback so a bearer request (which carries no cookie) can still call GitHub. The
// access token is JWE-encrypted with SESSION_ENC_KEY (session.ts encryptSecret).
export const oauthAccounts = sqliteTable('oauth_accounts', {
  userId: text('user_id').primaryKey(),
  provider: text('provider').notNull(), // v1: 'github'
  encryptedAccessToken: text('encrypted_access_token').notNull(),
  login: text('login').notNull(),
  name: text('name').notNull(),
  avatar: text('avatar').notNull(),
  scopesJson: text('scopes_json').notNull(), // JSON string[]
  updatedAt: integer('updated_at').notNull(),
})

// Idempotency replay store (docs/public-api.md). A retried mutation with the same
// (token, operation, key) + request hash returns the stored response; a different hash is a
// 409 idempotency_conflict. Rows expire after 24h and are swept by a maintenance path.
export const apiIdempotency = sqliteTable(
  'api_idempotency',
  {
    tokenId: text('token_id').notNull(),
    operationId: text('operation_id').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(), // sha256 of method+path+body
    responseStatus: integer('response_status').notNull(),
    responseBody: text('response_body').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tokenId, t.operationId, t.key] }), index('api_idempotency_expiry_idx').on(t.expiresAt)],
)

// Captured command executions (docs/public-api.md). Terminal-plugin-owned but
// the migration lives in the one app migration set. Bounded stdout/stderr so an HTTP client can
// reconnect after an app restart; a 24h record with capped output.
export const commandExecutions = sqliteTable(
  'command_executions',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(), // → tasks.id
    status: text('status').notNull(), // queued | running | succeeded | failed | cancelled | timed-out
    stdout: text('stdout').notNull().default(''),
    stderr: text('stderr').notNull().default(''),
    outputTruncated: integer('output_truncated', { mode: 'boolean' }).notNull().default(false),
    exitCode: integer('exit_code'),
    signal: text('signal'),
    timeoutMs: integer('timeout_ms').notNull(),
    createdAt: integer('created_at').notNull(),
    startedAt: integer('started_at'),
    completedAt: integer('completed_at'),
  },
  (t) => [index('command_executions_task_created_idx').on(t.taskId, t.createdAt), index('command_executions_status_idx').on(t.status)],
)
