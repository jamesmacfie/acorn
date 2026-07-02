import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
    // staleness: row is stale when now > fetchedAt + staleAfter; etag drives revalidation
    fetchedAt: integer('fetched_at').notNull(),
    staleAfter: integer('stale_after').notNull(),
    etag: text('etag'),
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
    fetchedAt: integer('fetched_at').notNull(),
    staleAfter: integer('stale_after').notNull(),
    etag: text('etag'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.repoId, t.number] })],
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
    sha: text('sha'), // blob sha — immutability key for the patch (docs/caching.md)
    patch: text('patch'), // private-repo patch body; public bodies live in KV by sha, this stays null
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

// Per-user third-party credentials. First-class, MULTI-ROW per provider (docs/workspaces 04): a
// user can connect several Linears / Rollbars, so the key is an opaque `id`, not (userId, provider).
// `label` disambiguates them in the UI ("Linear – work"). accessToken is ENCRYPTED at rest (JWE via
// SESSION_ENC_KEY, see session.ts encryptSecret) and never leaves the server — same posture as the
// GitHub token. GitHub itself is NOT stored here: it's the identity root (its token is the session
// cookie, userId is derived from it); it only *appears* as a synthesized entry in the list endpoint.
export const integrations = sqliteTable('integrations', {
  id: text('id').primaryKey(), // opaque uuid
  userId: text('user_id').notNull(),
  provider: text('provider').notNull(), // 'linear' | 'rollbar'
  label: text('label').notNull(), // user-facing name, seeded from the provider (e.g. workspace/org)
  accessToken: text('access_token').notNull(),
  meta: text('meta'), // optional JSON (e.g. { workspace }, base url, org id)
  createdAt: integer('created_at').notNull(),
})

// Local checkout for a GitHub repo (vNext §7, §9). Machine-scoped, NOT user-scoped: it describes
// *this machine's* filesystem, so there's no userId — the terminal service in the Electron main
// process reads it outside any GitHub user context. PK is (owner, repo).
export const repoPaths = sqliteTable(
  'repo_paths',
  {
    owner: text('owner').notNull(),
    repo: text('repo').notNull(),
    githubRepoId: integer('github_repo_id'),
    path: text('path').notNull(),
    // Per-repo dev-server config (docs/workspaces 05 / P5). runCommand is run in a workspace's
    // worktree with PORT = devPort + the workspace's rail offset, so two workspaces don't collide.
    runCommand: text('run_command'),
    devPort: integer('dev_port'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.owner, t.repo] })],
)

// A Workspace is a named GROUP of repos (docs/workspaces) — "Runn", "Acorn". The top-level unit
// the user selects in the top bar. Machine-scoped like repo_paths / tasks (single-user machine).
// A repo belongs to exactly one workspace (partition) — see workspaceRepos.
export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(), // opaque uuid
  name: text('name').notNull(), // editable label
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false), // the catch-all group
  sort: integer('sort').notNull().default(0), // selector ordering
  setupScript: text('setup_script'), // shell command run once when a task worktree is created; null/blank = none
  setupScriptTrigger: text('setup_script_trigger'), // 'off' | 'created' | 'terminal' — when to run it; null → 'terminal'
  previewMode: text('preview_mode'), // 'url' | 'port' | 'script' — how the browser-preview URL is resolved; null → dev-server port
  previewValue: text('preview_value'), // the URL, port, or shell command per previewMode; null/blank = unset
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

// Repos the user has chosen to hide from workspaces (docs/workspaces). An ignored repo has no
// workspace_repos row, so it's excluded from the selector/rail/scoping everywhere; the onboarding
// modal still lists it (it iterates all mirrored repos) so it can be reassigned to bring it back.
// Bootstrap skips repos that are ignored so they don't silently reappear in Default.
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
// integrations (docs/workspaces 04). Provider-agnostic — generalizes the old
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

// A Task is the single-repo unit of work (docs/workspaces/03-data-model.md): a repo + branch +
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
  status: text('status').notNull(), // 'active' | 'archived'
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
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.integrationId, t.identifier] })],
)

// Durable terminal sessions (vNext §7). Machine-scoped like repo_paths. We persist ONLY tmux-backed
// sessions: tmux outlives an app restart, so on startup the service reconciles these rows against
// `tmux list-sessions` and re-attaches the survivors. node-pty sessions die with the process and
// live only in the in-memory map. No terminal output is ever stored (vNext §8). ponytail: a §7
// subset — no pid / last_attached_at (we re-derive liveness from tmux, not a stored pid).
// Bound to a task (docs/workspaces/03): repo / branch / PR are derived through the
// taskId → tasks join, so the loose repo_owner / repo_name / pull_number columns are gone.
export const terminalSessions = sqliteTable('terminal_sessions', {
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
})

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
