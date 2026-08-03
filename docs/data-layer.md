# Data Layer

The local SQLite database: 37 [Drizzle ORM](https://orm.drizzle.team/) tables (plus one hand-written
FTS5 virtual table) that back everything acorn shows — the GitHub read-model mirror and acorn's own
app-state.

> **Runtime note:** acorn migrated from Cloudflare Workers to a local Electron app (see
> [electron.md](./electron.md)). The read-model mirror is unchanged but now lives in local SQLite
> (better-sqlite3 + Drizzle) as `core.sqlite` in the node's data root — `apps/node/.acorn/` in a dev
> checkout — not D1. `db.batch()` is emulated via a transaction (electron.md §4c). Read any lingering
> "D1" as "the local SQLite DB".

The schema has three ownership classes:

- **Mirror tables** — cached projections of GitHub (and, generically, of external issue providers)
  data. Disposable, revalidated, populated on read. The SQLite mirror is a *cache of GitHub, not a
  source of truth* (see [architecture-overview](./architecture-overview.md)).
- **App-state tables, identity-scoped** — data GitHub does not have but which must follow the active
  identity: prefs, pins, viewed-file state, integration credentials, and encrypted HTTP
  requests/variables. Keyed by `userId`; acorn owns them.
- **App-state tables, machine-scoped** — data that describes *this machine* (local checkouts,
  worktrees, tasks, terminals, notes, memory). No `userId` — they exist outside any GitHub user
  context. acorn owns them.

Source: `packages/node-core/src/server/db/schema.ts` (fully commented — the source of truth for every
column), `packages/node-core/src/server/db/index.ts`, `packages/node-core/src/server/db/resourceKeys.ts`,
`packages/node-core/migrations/`.

## Drizzle client

```ts
export const getDb = (env: Env): AppDatabase => env.DB
```

`env.DB` is the better-sqlite3 Drizzle client, built once at startup in
`packages/node-core/src/main/bindings.ts` (with an emulated `.batch()`, since better-sqlite3 has no native
batch — see [electron.md](./electron.md) §4c). `getDb(env)` just hands it back; routes import it
directly.

## User-scoping rule

Every **mirror** table and every **GitHub-scoped** app-state table is keyed by `userId` (the GitHub
`login`). This is the data-model expression of the **public/private rule**: a private repo's mirror
must never serve across users. Two users may mirror the same private repo, so the GitHub repo `id`
alone is *not* unique — the primary key includes `userId`.

> `userId = user.login`. A `ponytail:` note in the source flags login-as-scope as "stable enough;
> revisit if logins churn."

**Machine-scoped** app-state tables (`repo_paths`, `workspaces`, `tasks`, …) deliberately have *no*
`userId`. They describe the local filesystem and the user's work on it — the terminal engine in the
node service process reads them outside any GitHub user context, and on a single-user machine there
is no second user to isolate from. See [user- vs machine-scoping](#user--vs-machine-scoping) below.

Patch/blob bodies are the one thing kept outside the tables entirely: the on-disk `BLOBS` cache
(`blobs/` in the data root) holds immutable bodies keyed by sha. On a single-user machine
the cache is private to you, so there is no public/private split. See [caching](./caching.md).

---

## Table catalog

### Group 1 — Mirror tables (cached projections of GitHub)

These cache GitHub. They carry staleness bookkeeping (per-row or via `sync_state`) and are refreshed
delete-then-insert / upsert. Disposable — dropping any of them just forces a re-fetch.

#### `repos`

Mirror of the repos the user can see. PK `(userId, id)` — `id` is the GitHub repo id.

| Column | Type | Note |
| --- | --- | --- |
| `userId` | text | scope (GitHub login) |
| `id` | integer | GitHub repo id |
| `owner`, `name` | text | |
| `private` | boolean | repo visibility; no longer affects caching (all bodies cache locally) |
| `defaultBranch` | text | nullable |
| `pushedAt` | integer | epoch ms; the repo selector orders by this |
| `fetchedAt` | integer | epoch ms; legacy staleness base — the sync engine now gates the repos list on the `repos` `sync_state` row's `fetchedAt` (this column is the pre-ETag fallback for un-synced mirrors); TTL is `REPOS_STALE_AFTER_MS` in `server/sync/policy.ts` |

#### `pull_requests`

Mirror of PR headers. PK `(userId, repoId, number)`.

| Column | Type | Note |
| --- | --- | --- |
| `userId`, `repoId`, `number` | text/int/int | scope + PR identity |
| `nodeId` | text | GraphQL node id — needed for draft↔ready toggles |
| `state` | text | `open` \| `closed` \| `merged` |
| `draft` | boolean | |
| `title` | text | |
| `body` | text | sanitized `bodyHTML` from GraphQL (rendered via `innerHTML`) |
| `headSha` | text | head commit oid — `commit_id` for creating line comments |
| `headRef`, `baseRef`, `author` | text | |
| `updatedAt` | integer | epoch ms |
| `mergeable` | text | `MERGEABLE` \| `CONFLICTING` \| `UNKNOWN` |
| `mergeStateStatus` | text | `CLEAN` \| `BLOCKED` \| `BEHIND` \| `DIRTY` \| `DRAFT` \| `UNSTABLE` \| `UNKNOWN` |
| `autoMergeEnabled` | boolean | |
| `fetchedAt` | integer | epoch ms; staleness base (TTLs are route constants; the list ETag lives in `sync_state`) |

#### PR-detail children

Mirrored together from the GraphQL composite read (`pr_files` from REST) and **replaced wholesale on
each sync**. They have **no per-row staleness** — freshness is governed centrally by `sync_state`
(`pr:<repoId>:<number>`). All user-scoped and keyed off the PR `(userId, repoId, number)` plus a
per-row discriminator.

| Table | Purpose | PK discriminator | Notable columns |
| --- | --- | --- | --- |
| `pr_files` | changed files in the PR | `path` | `status` (added/modified/removed/renamed…), `additions`, `deletions`, `sha` (blob sha), `patch` — **always null**; bodies resolve from the on-disk BLOBS cache by sha |
| `reviews` | submitted reviews | `id` (node id) | `author`, `state` (`APPROVED`/`CHANGES_REQUESTED`/`COMMENTED`/`DISMISSED`/`PENDING`), `body`, `submittedAt` |
| `comments` | PR conversation (issue) comments | `id` (node id) | `author`, `body`, `createdAt` |
| `pr_commits` | commits in the PR | `sha` | `message`, `author`, `authorLogin`, `committedAt` |
| `review_threads` | inline review-comment threads (one row per comment) | `id` (comment node id) | thread-level fields denormalized onto each row: `threadId`, `path`, `line`, `side` (`RIGHT`/`LEFT`), `resolved`; `databaseId` is the numeric id REST needs for replies; plus `author`, `body`, `createdAt` |
| `pr_labels` | labels on the PR | `name` | `color` (6-hex, no leading `#`) |
| `review_requests` | pending review requests | `login` | user logins only — `ponytail:` team review requests are not mirrored |
| `checks` | CI checks / status contexts | `name` | `status` (CheckRun conclusion/status or StatusContext state), `url`, `runId` (Actions `workflowRun.databaseId`; null for status contexts — enables rerun-failed-jobs) |

#### `sync_state`

Collection-level revalidation bookkeeping. PK `(userId, resource)`. A list endpoint's ETag and
last-fetch time have no per-row home, so they live here (see [caching](./caching.md)).

| Column | Type | Note |
| --- | --- | --- |
| `userId` | text | scope |
| `resource` | text | resource key — see [resource keys](#sync_state-resource-keys) |
| `etag` | text | the collection ETag for conditional revalidation (where available) |
| `fetchedAt` | integer | epoch ms; the TTL gate compares `fetchedAt + <route TTL>` to now |

A read checks `sync_state` first: if fresh within the TTL, it serves the mirror with no GitHub call.
PR-detail mutations bust the relevant `sync_state` row (`bustPrSync` in `routes/prContext.ts`; PR
creation deletes the open-list row in `routes/prCreate.ts`) so the next read refetches (see
[github-integration](./github-integration.md)).

#### `issues`

Per-user cache of fetched **external** issues (Linear tickets, Rollbar errors) — the mirror analogue
of `integrations`, generic across providers. PK `(userId, integrationId, identifier)`. Serve-then-
revalidate by TTL.

| Column | Type | Note |
| --- | --- | --- |
| `userId` | text | scope |
| `integrationId` | text | → `integrations.id` — keying by connection stops the same identifier fetched via two connections from colliding |
| `provider` | text | registered provider id, denormalized from the integration |
| `identifier` | text | e.g. `ENG-123` |
| `data` | text | provider-codec-owned, versioned `CachedExternalItem` JSON; summary refreshes preserve detail |
| `fetchedAt` | integer | epoch ms; TTL base (Linear: 10 min, `routes/linear.ts`; Rollbar: 2 min, `routes/rollbar.ts` — see [caching](./caching.md)) |

#### `issue_resources`

Provider-owned child-resource mirror for an external issue. PK
`(userId, integrationId, issueIdentifier, resource, identifier)`. Rollbar uses it for an item's
occurrence list and each independently-loaded normalized occurrence. `data` is resource-specific JSON;
`fetchedAt` is that child resource's TTL base. Keeping child payloads outside `issues.data` prevents a
large occurrence from evicting the item summary and lets inactive UI tabs remain cold.

### Group 2 — App-state tables, identity-scoped (per-user)

acorn owns these. No mirror, no TTL — they survive mirror re-syncs. Keyed by `userId`.

#### `viewed_files`

Per-user "I've reviewed this file" checkboxes. PK `(userId, repoId, number, path)`. Not a GitHub
concept; merged into the files read on every request so it persists across mirror re-syncs.

| Column | Type | Note |
| --- | --- | --- |
| `userId`, `repoId`, `number`, `path` | | PR file identity |
| `viewedAt` | integer | epoch ms when checked |

#### `pinned_repos`

Per-user pinned repos for the selector. PK `(userId, repoId)`. Ordered by `sort` ascending
(appended at `max(sort)+1`).

| Column | Type | Note |
| --- | --- | --- |
| `userId`, `repoId` | text/int | |
| `sort` | integer | selector ordering, default 0 |

#### `prefs`

Per-user key→value preferences. PK `(userId, key)`. `GET /v2/core/prefs` returns a key→value map;
`PUT` upserts one key.

| Column | Type | Note |
| --- | --- | --- |
| `userId`, `key` | text | key: theme, diff view mode, keybinding overrides, `editor_command_default`, … |
| `value` | text | stored as text (JSON-encoded where structured) |

#### `integrations`

Per-user third-party credentials. First-class and **multi-row per provider**: a user can connect
several Linears / Rollbars, so the PK is an opaque `id`, not `(userId, provider)`. `label`
disambiguates them in the UI ("Linear – work").

| Column | Type | Note |
| --- | --- | --- |
| `id` | text (PK) | opaque uuid |
| `userId` | text | owner |
| `provider` | text | registered provider id (`linear`, `rollbar`, …) |
| `label` | text | user-facing name, seeded from the provider (workspace/org) |
| `accessToken` | text | mapped as `authRef`; **encrypted at rest** and never returned |
| `authKind`, `status` | text | core connection lifecycle |
| `account`, `scopes`, `capabilities` | text | provider-normalized JSON safe for public summaries |
| `config` | text | provider-codec-owned non-secret JSON |
| `lastValidatedAt`, `lastError` | integer / text | health state |
| `createdAt`, `updatedAt` | integer | epoch ms |

> GitHub **is** stored here — one row per owner under provider `github`, written by the device-flow
> connect route and read only through `githubToken(c)`
> (`plugins/github/src/server/githubToken.ts`). It is still the identity root: `userId` is the GitHub
> login every other user-scoped table is keyed by, and GitHub also *appears* as a synthesized entry in
> the integrations list endpoint. See [integrations](./integrations.md),
> [authentication](./authentication.md).

### Group 3 — App-state tables, machine-scoped (no userId)

These describe the local machine and the user's work on it. No `userId` (single-user machine). acorn
is the source of truth. Several are desktop-capability-gated, as noted per table.

#### `repo_paths`

The local checkout for a GitHub repo. PK `(owner, repo)`. Machine-scoped: it names *this machine's*
filesystem, read by the terminal service outside any GitHub user context.

| Column | Type | Note |
| --- | --- | --- |
| `owner`, `repo` | text | PK |
| `githubRepoId` | integer | link back to the mirror (nullable) |
| `path` | text | absolute checkout path |
| `runTargets` | text | JSON `RunTarget[]` — DB fallback below a committed `.acorn/config.toml`, parsed by `main/runConfig.ts`. (The legacy scalar `run_command`/`dev_port` columns were folded into it by migration `0017` and dropped by `0018`.) |
| `editorCommand` | text | external editor for this repo's worktrees (`code`/`zed`/`cursor -n`/abs path); null → prefs `editor_command_default` → `code` |
| `setupScript` | text | shell run once when a task worktree is created; null/blank = none |
| `setupScriptTrigger` | text | `off` \| `created` \| `terminal` — when to run it; null → `terminal` |
| `devScript` | text | "run dev" → a `dev` run target; null/blank = no run button |
| `devRestartScript` | text | restart command for the `dev` target; when set, `run_restart` uses it instead of stop+start |
| `teardownScript` | text | shell run in the worktree just before removal (docs/terminal-and-agents.md); null/blank = none |
| `dbUrlScript` | text | shell run in the worktree that prints a Postgres URL for the Database pane (docs/pg.md); null/blank = auto-detect |
| `dbSchemaMode` | text | `auto` \| `script` \| `file` schema source for model-assisted SQL |
| `dbSchemaValue` | text | script or worktree-relative file for that mode |
| `dbSchemaNotes` | text | repo-specific schema semantics sent with model requests |
| `previewMode` | text | `url` \| `port` \| `script` — how the browser-preview URL resolves; null → dev-server port |
| `previewValue` | text | the URL/port/command per `previewMode`; null/blank = unset |
| `browserRules` | text | JSON `BrowserRule[]` — preview-browser page rules (docs/panes.md); null = none |
| `branchPrefix` | text | normalized personal prefix for branches derived from new task titles |
| `createdAt`, `updatedAt` | integer | epoch ms |

The lifecycle/build/db/preview columns above are the machine-local DB fallback beneath a committed
`.acorn/config.toml` (`main/runConfig.ts` `loadRepoConfig` precedence: committed repo toml → user
`~/.acorn/config.toml` → these columns). They **moved off `workspaces` (repo-level-settings)**: a
workspace groups repos, but this config describes one repo. `browserRules` is DB-only (dev-login
autofill selectors are machine/personal, not committed). Write via
`PUT /v2/p/terminal/terminal/repo-path/config`.

#### `workspaces`

A **Workspace** is a named *group of repos* ("Runn", "Acorn") — the top-level unit selected in the
top bar (see [workspaces-and-tasks](./workspaces-and-tasks.md)). PK opaque `id`. Machine-scoped.
**Pure grouping**: identity + membership only — build/run/db/preview config is repo-level (`repo_paths`).

| Column | Type | Note |
| --- | --- | --- |
| `id` | text (PK) | opaque uuid |
| `name` | text | editable label |
| `isDefault` | boolean | the catch-all group |
| `sort` | integer | selector ordering |
| `icon` | text | JSON `WorkspaceIcon` (`emoji`/`lucide`/`github`); null → derived default |
| `color` | text | preset token key or 6-hex; null → derived from name hash |
| `createdAt`, `updatedAt` | integer | epoch ms |

There is intentionally no generic `workspace_config` / `repo_config` key/value table. Typed columns on
`repo_paths` remain the validated fallback layer, while shareable extensible configuration lives in
`.acorn/config.toml` and personal defaults in `~/.acorn/config.toml`. This keeps executable config
reviewable in files and avoids moving typed contracts into an unstructured row store. Revisit only
if a contribution needs repo-scoped values that cannot be represented by the file layers or a
provider-owned typed config codec.

#### `config_acks`

Machine-scoped acknowledgements for repo-authored executable configuration. The composite key is
`(repo, hash)`; `snapshot` retains the exact approved source for the next changed-config diff and
`ackedAt` provides the latest approved baseline. This is deliberately narrower than a general
workspace configuration table.

#### `workspace_repos`

Repo → Workspace membership (a partition — a repo lives in exactly one workspace). PK
`(repoOwner, repoName)`. The on-disk path is **not** here — it stays in `repo_paths`, joined by
`(owner, repo)`.

| Column | Type | Note |
| --- | --- | --- |
| `workspaceId` | text | → `workspaces.id` |
| `repoOwner`, `repoName` | text | PK — one workspace per repo |
| `sort` | integer | ordering within the workspace |
| `createdAt` | integer | epoch ms |

#### `ignored_repos`

Repos the user has hidden from workspaces. PK `(owner, repo)`. An ignored repo keeps its
`workspace_repos` membership but readers exclude it from selector/rail/scoping; onboarding can
unhide it in place. Bootstrap skips ignored repos so they do not silently reappear in Default.

| Column | Type | Note |
| --- | --- | --- |
| `owner`, `repo` | text | PK |
| `createdAt` | integer | epoch ms |

#### `workspace_projects`

External projects (Linear/Rollbar/…) linked to a workspace — the project backs every repo in the
workspace. PK `(workspaceId, integrationId, externalId)`. Provider-agnostic; generalizes the old
`workspace_linear_projects` / per-repo prefs key.

| Column | Type | Note |
| --- | --- | --- |
| `workspaceId` | text | → `workspaces.id` |
| `integrationId` | text | → `integrations.id` — which connection the project belongs to |
| `externalId` | text | the provider's project id within that connection |
| `createdAt` | integer | epoch ms |

#### `tasks`

A **Task** is the single-repo *unit of work*: repo + branch + optional worktree + optional linked PR
+ its panes/terminals. Shown as a row in the TabRail. PK opaque `id`. Its parent workspace is derived
via `workspace_repos` on `(repoOwner, repoName)`. Machine-scoped (it owns a local worktree).

| Column | Type | Note |
| --- | --- | --- |
| `id` | text (PK) | opaque uuid |
| `title` | text | editable; seeded from origin (PR title, ticket, …) |
| `icon` | text | optional Lucide icon; null derives from origin |
| `origin` | text | `github-pr` \| `linear` \| `rollbar` \| `local` |
| `repoOwner`, `repoName` | text | a task always belongs to a repo |
| `branch` | text | the branch this task works on |
| `worktreePath` | text | null until a worktree-dependent action ensures it |
| `pullNumber` | integer | null for local-first until a PR is inherited |
| `status` | text | `active` \| `archived`; workflow-created child tasks may end as `cancelled` |
| `parentId` | text | task tree; set on fan-out children; null = root |
| `sort` | integer | rail ordering |
| `createdAt`, `updatedAt` | integer | epoch ms |
| `archivedAt` | integer | set on archive; row kept for history/teardown audit |

#### `task_links`

Zero-or-more external items a task references (Linear tickets, Rollbar errors). PK
`(taskId, integrationId, identifier)`. `(integrationId, identifier)` matches the PK tail of `issues`,
so a link resolves straight to cached detail.

| Column | Type | Note |
| --- | --- | --- |
| `taskId` | text | → `tasks.id` |
| `integrationId` | text | → `integrations.id` — pins the item to one connection |
| `provider` | text | registered provider id, stamped from the connection by core |
| `identifier` | text | `ENG-42` \| rollbar item id |
| `refJson` | text | nullable complete `ExternalRef` for providers needing external ids or locators |
| `createdAt` | integer | epoch ms |

#### `review_notes`

Local review notes: inline annotations on **uncommitted** changes, sent to the agent as a prompt —
acorn-owned app state (PR comments stay GitHub-owned). PK opaque `id`. Machine-scoped. The single
home for anchored annotations (README decision 16 — generalize the anchor rather than adding a second
store).

| Column | Type | Note |
| --- | --- | --- |
| `id` | text (PK) | |
| `taskId` | text | → `tasks.id` |
| `path` | text | repo-relative file |
| `side` | text | `additions` \| `deletions` |
| `startLine`, `endLine` | integer | anchored line range |
| `snippet` | text | the anchored lines (for the prompt + re-anchoring) |
| `body` | text | the note |
| `sentAt` | integer | stamped on delivery; cleared on edit |
| `createdAt` | integer | epoch ms |

#### `db_saved_queries`

Repo-scoped named SQL snippets for the Database pane. Machine-scoped because they describe a local
repo workflow, not an authenticated upstream account. Unique on `(repoOwner, repoName, name)`;
saving an existing name overwrites it.

| Column | Type | Note |
| --- | --- | --- |
| `id` | text (PK) | opaque uuid |
| `repoOwner`, `repoName` | text | owning repo |
| `name` | text | unique within the repo |
| `notes` | text | query intent/gotchas supplied to model-assisted generation |
| `sql` | text | saved SQL |
| `createdAt`, `updatedAt` | integer | epoch ms |

#### `memories` (+ `memories_fts`)

Derived index over the memory markdown files that are the *truth*
(`<worktree>/.acorn/memory` committed, `~/.acorn/memory` private). PK `id` = `sha256(content)` prefix
(idempotent across N checkouts). Reconciled on change from all active worktrees + primary checkouts;
conflicts on `(scope, repo, name)` resolve newest-`updatedAt`. Machine-scoped. See
[notes-and-memory](./notes-and-memory.md).

| Column | Type | Note |
| --- | --- | --- |
| `id` | text (PK) | content-hash prefix |
| `scope` | text | `repo` \| `private` |
| `repo` | text | `owner/name` for repo scope; null for private |
| `name` | text | |
| `type` | text | `convention`\|`architecture`\|`decision`\|`fix`\|`reference`\|`feedback`\|`task`\|`user` |
| `description`, `body` | text | |
| `path` | text | the winning file on disk |
| `originSessionId`, `commitSha`, `supersededBy` | text | provenance / lineage |
| `createdAt`, `updatedAt` | integer | epoch ms |
| `lastAccessedAt` | integer | |
| `accessCount` | integer | default 0 |

**`memories_fts`** is a hand-written FTS5 virtual table (Drizzle does not model virtual tables), created
in migration `0011`:

```sql
CREATE VIRTUAL TABLE `memories_fts`
  USING fts5(`id` UNINDEXED, `name`, `description`, `body`, tokenize='porter');
```

It full-text indexes `name`/`description`/`body` with the porter stemmer; `id` is stored but not
indexed so a hit maps back to the `memories` row. It is kept in sync by application code, not by a
Drizzle relationship.

#### Managed-agent tables

Managed sessions are machine-scoped, task-owned local history. Provider credentials and raw protocol
payloads are never stored. The normalized event ledger is append-only; session/turn/request rows are
transactional query projections. Full contracts and state vocabularies are in
[managed-agents](./managed-agents.md).

| Table | Key data / invariant |
| --- | --- |
| `agent_sessions` | task/provider/profile, opaque provider resume ref, exclusive controller, runtime/attention/authority, config, lineage, event/read cursors, archive timestamps |
| `agent_turns` | unique `(sessionId, ordinal)` and `(sessionId, idempotencyKey)`; durable queue, input/policy manifest, provider ref, usage/error/timing and safe-retry attempt |
| `agent_events` | unique monotonically increasing `(sessionId, seq)`; schema-versioned normalized event JSON and bounded search text |
| `agent_events_fts` | migration-owned FTS5 projection synchronized by triggers |
| `agent_requests` | unique provider request per session; `pending → resolving → resolved/expired` closes double-answer races |
| `agent_attachments` / `agent_attachment_refs` | task-scoped content hash/metadata plus turn references into the separate attachment object store |
| `agent_artifacts` | session/turn metadata and optional storage key for large typed outputs |
| `agent_operations` | bounded command idempotency results not naturally owned by another resource |
| `agent_webhooks` | optional task-filtered content-free completion/attention target and encrypted HMAC secret |
| `agent_webhook_deliveries` | unique event delivery, bounded retry state, response status/error and delivery timestamp |

#### `terminal_sessions`

Durable terminal sessions. PK opaque `id`. Machine-scoped. **Desktop-only** — the terminal drawer
requires the node service's terminal capability and is always on in the Electron app (`capabilities()`,
`packages/client-core/src/capabilities.ts`).
Only **tmux-backed** sessions are persisted (tmux outlives an app restart; node-pty sessions die with
the process and live only in the in-memory map). No terminal output is ever stored. Bound to a task —
repo/branch/PR are derived through the `taskId → tasks` join.

| Column | Type | Note |
| --- | --- | --- |
| `id` | text (PK) | |
| `title` | text | |
| `kind` | text | `shell` \| `agent` |
| `profileId` | text | terminal profile |
| `backend` | text | `node-pty` \| `tmux` (only tmux rows persisted) |
| `status` | text | `running` \| `exited` |
| `cwd` | text | working dir |
| `taskId` | text | → `tasks.id` |
| `command` | text | |
| `argvJson` | text | JSON argv, default `[]` |
| `tmuxSession` | text | tmux session name (for reconciliation/re-attach) |
| `cols`, `rows` | integer | pty size |
| `createdAt`, `exitedAt` | integer | epoch ms |
| `exitCode` | integer | set on exit |

#### `workflow_runs`

The durable checkpoint for the node service's workflow state machine — every transition is persisted so
a run survives an app restart. PK opaque `id`. Machine-scoped. The registry-backed runtime supports
gates, joins, branching, bounded fan-out, cancellation, tool ceilings, and reconciliation; it is
desktop-capability-gated. See [workflows](./workflows.md).

| Column | Type | Note |
| --- | --- | --- |
| `id` | text (PK) | |
| `taskId` | text | → `tasks.id` (the worktree/agent scope) |
| `name` | text | |
| `status` | text | `running` \| `gated` \| `cancelling` \| `done` \| `failed` \| `safety-rail` \| `cancelled` |
| `posture` | text | `gated` (default) \| `autonomous` |
| `trigger` | text | default `manual` |
| `defJson` | text | the `WorkflowDef` this run executes (frozen at start) |
| `error` | text | |
| `createdAt`, `updatedAt` | integer | epoch ms |

#### `workflow_steps`

One step of a run. PK opaque `id`. Machine-scoped. Same flag/design-stage status as `workflow_runs`.
Steps carry a first-class working context (`worktreePath`); structured output is the edge currency
(branch/join material).

| Column | Type | Note |
| --- | --- | --- |
| `id` | text (PK) | |
| `runId` | text | → `workflow_runs.id` |
| `idx` | integer | sequence position |
| `name` | text | |
| `kind` | text | registry id; built-ins include `agent`, gates, `ci-loop`, `fan-out`, `join`, `decide` |
| `mode` | text | `headless` \| `ai` \| `interactive` (default `headless`) |
| `profileId`, `model` | text | |
| `status` | text | `pending`\|`running`\|`waiting-gate`\|`done`\|`failed`\|`skipped`\|`safety-rail`\|`cancelled` |
| `worktreePath` | text | first-class working context |
| `inputsJson` | text | the assembled bundle handed to the step |
| `resultJson` | text | captured `HeadlessResult` (sans events) |
| `structuredJson` | text | schema-conforming output — the edge currency |
| `sessionId` | text | for `--resume` (open in terminal) |
| `agentSessionId` | text | → `agent_sessions.id` for managed workflow steps |
| `costUsd` | real | |
| `iteration` | integer | loop-bound bookkeeping (default 0) |
| `parentStepId` | text | fan-out lineage |
| `error` | text | |
| `createdAt`, `updatedAt` | integer | epoch ms |

### Group 4 — Device identity, replay, and encrypted HTTP state

These tables share a platform/security lifecycle rather than one physical scope. Device rows and the
replay store belong to the node itself and carry no `userId`; HTTP-client rows follow a GitHub
identity.

#### `devices`

One row per paired client — the authentication root. PK opaque `id`, which is also the public half of
the bearer token `acorn_dt_<id>_<secret>`. Only `secretHash` (sha256 of the secret) is stored; the
plaintext is returned exactly once, at pairing. `name` is user-supplied, `lastSeenAt` is best-effort
telemetry written at most once per throttle window and off the request path, and `revokedAt` is set
once and never unset — revocation is permanent, so the row survives to show what was revoked and
when, and a replayed token can never be resurrected. There are no scopes: every paired device has
full owner authority. See [security](./security.md).

#### `idempotency`

24-hour replay rows keyed by `(deviceId, key)`, where `key` is the client-minted `Idempotency-Key`
header. A retry carrying the same `requestHash` (`sha256(method \n path \n rawBody)`) replays the
stored status and body; reusing a key for different input is an idempotency conflict. A `5xx` is never
stored, so a genuine retry re-executes. `expiresAt` is indexed for the sweep.

#### `http_requests` — saved requests for the API panel

Repo-scoped and GitHub-user-scoped: a request written against a repo's API outlives any one task
worktree but never crosses a sequential identity switch. See [http-client.md](./http-client.md).

| Column | Type | Note |
| --- | --- | --- |
| `id` | text (PK) | |
| `userId` | text | authenticated GitHub login that owns the saved request |
| `repoOwner`, `repoName` | text | the owning repo |
| `folder` | text | a slash path (`auth/login`), `''` = root. **Not** a folders table — the client splits on `/` to build the tree, so renaming a folder is one `UPDATE` and there are no orphans or cycles. The one cost is that a folder cannot exist while empty. |
| `taskId` | text | → `tasks.id`. Set = an ad-hoc request owned by that task; null = saved in the repo tree. Filing an ad-hoc request clears it. |
| `name` | text | |
| `method`, `url` | text | method is plaintext metadata; URL is JWE ciphertext (including query string) |
| `headers` | text | JWE-encrypted JSON `KeyValue[]` |
| `bodyMode` | text | `none` \| `json` \| `text` \| `form` |
| `body` | text | JWE-encrypted raw string, or JSON `KeyValue[]` when `bodyMode` is `form` |
| `auth` | text | JWE-encrypted JSON `AuthConfig` |
| `vars` | text | JWE-encrypted JSON `Record<string,string>` |
| `encrypted` | integer (bool) | false only during a pre-listener legacy migration |
| `createdAt`, `updatedAt` | integer | epoch ms |

#### `http_variables` — repo-level variables for the API panel

Unique on `(userId, repoOwner, repoName, name)`. Per-request overrides are the `vars` column above,
not rows here — which is why there is no nullable request id and no `''` sentinel.

| Column | Type | Note |
| --- | --- | --- |
| `id` | text (PK) | |
| `userId` | text | authenticated GitHub login that owns the variable |
| `repoOwner`, `repoName` | text | |
| `name` | text | the `{{NAME}}` placeholder |
| `kind` | text | `value` \| `secret` \| `command` |
| `value` | text | JWE ciphertext under `SESSION_ENC_KEY` for all kinds. A `command` value is decrypted and run at send time and its **result is never persisted**; a `secret`'s plaintext is never returned to the renderer. |
| `encrypted` | integer (bool) | false only during a pre-listener legacy migration |
| `enabled` | integer (bool) | |
| `createdAt`, `updatedAt` | integer | epoch ms |

---

## Relationships

There are no foreign-key constraints in SQLite here — relationships are by convention (shared key
columns) and enforced in application code (e.g. `cascadeDeleteIntegration` in
`packages/node-core/src/server/db/cascade.ts` for disconnecting an integration). Accordingly `openDb`
(`packages/node-core/src/main/bindings.ts`) sets no `foreign_keys` pragma — with no declared `references()` it would
be a no-op implying enforcement this doc explicitly says doesn't exist. The important joins:

**GitHub mirror hierarchy.** `repos (userId, id)` ← `pull_requests (userId, repoId, number)` ← the
PR-detail children, each keyed `(userId, repoId, number, …)`:

Because the schema deliberately has no foreign keys, repo-list and pull-list refreshes carry
explicit child deletions in the same transaction as parent eviction. Startup reconciliation removes
orphaned children left by older releases.

```
repos(userId, id)
  └─ pull_requests(userId, repoId=id, number)
       ├─ pr_files       (…, path)
       ├─ reviews        (…, id)
       ├─ comments       (…, id)
       ├─ pr_commits     (…, sha)
       ├─ review_threads (…, id)   [thread fields denormalized per row]
       ├─ pr_labels      (…, name)
       ├─ review_requests(…, login)
       └─ checks         (…, name)
```

`pr_files.sha` is the immutability key into the on-disk BLOBS cache — the patch body lives there,
never in the row (the old always-null `pr_files.patch` column is dropped).

**`sync_state` resource keys** (`packages/node-core/src/server/db/resourceKeys.ts`) gate the collections
that have no natural per-row freshness home:

| Key | Builder | Gates |
| --- | --- | --- |
| `pulls:<repoId>:<open\|closed>` | `pullsResource` | a PR-list page for a repo/state |
| `pr:<repoId>:<number>` | `prResource` | one PR's whole detail composite (all children above) |
| `files:<repoId>:<number>` | `filesResource` | the PR's changed-files list |
| `provider:<providerId>:<connectionId>:<resource>:<scope>` | provider descriptor `key` | provider collections, including an empty Rollbar item list |

**Workspace ↔ repos ↔ path.** A workspace groups repos; the local checkout is stored separately and
joined by owner/name:

```
workspaces(id)
  └─ workspace_repos(workspaceId, repoOwner, repoName)   -- one workspace per repo (partition)
        └─ repo_paths(owner=repoOwner, repo=repoName)     -- this machine's checkout + run config
  └─ workspace_projects(workspaceId, integrationId, externalId)  -- linked external projects
ignored_repos(owner, repo)   -- independent hidden marker; membership is retained
```

**Task graph.** A task is the hub for local work; its dependents point at `tasks.id`:

```
tasks(id)
  ├─ task_links(taskId, integrationId, identifier)   -- (integrationId, identifier) → issues PK tail
  ├─ review_notes(taskId)
  ├─ agent_sessions(taskId)
  │    ├─ agent_turns(sessionId) ── agent_attachment_refs(turnId)
  │    ├─ agent_events(sessionId)
  │    ├─ agent_requests(sessionId)
  │    └─ agent_artifacts(sessionId)
  ├─ terminal_sessions(taskId)
  └─ workflow_runs(taskId)
        └─ workflow_steps(runId)                     -- parentStepId fan-out; agentSessionId managed lineage
tasks.parentId → tasks.id                            -- task tree (fan-out children)
db_saved_queries(repoOwner, repoName)                 -- repo-scoped, not task-scoped
```

**Integrations fan-out.** `integrations.id` is referenced by `issues`, `task_links`,
`workspace_projects` (and `integrations.provider` is denormalized onto `issues`/`task_links` for cheap
filtering). `task_links (integrationId, identifier)` deliberately matches the tail of the `issues` PK
`(userId, integrationId, identifier)`, so a task's external link resolves straight to cached issue
detail without a lookup table.

---

## User- vs machine-scoping

Why some tables have `userId` and some do not:

- **`userId` present** (mirror + identity-scoped app-state): the data belongs to a GitHub identity and
  must obey the public/private rule — a private repo's mirror or a user's viewed-file state must never
  cross users, so `userId` is part of the PK.
- **`userId` absent** (machine-scoped app-state): the data describes *this machine* — a local
  checkout path (`repo_paths`), a worktree-backed task (`tasks`), a tmux session
  (`terminal_sessions`), a memory file on disk (`memories`). It is read by the node's domain
  engines outside any GitHub request context. On a single-user machine
  there is no second user to isolate from, so adding `userId` would be dead weight.

`integrations` (including the GitHub credential) and the encrypted HTTP-client rows sit on the
identity-scoped side. `devices` and `idempotency` sit on neither: they describe *this node's* paired
clients, not an upstream account. Integration dependents that describe local work — `task_links`,
`workspace_projects` — reference it by `integrationId` from the machine-scoped side.

## Staleness / ETag bookkeeping

Two freshness patterns coexist:

The single owner of *when* to serve/refresh is `serveThenRevalidate`
(`server/sync/engine.ts`); TTLs live in `server/sync/policy.ts`. The store that
backs freshness varies:

- **Per-collection** (`sync_state`): the repos list, PR list, PR-detail children,
  and PR/file lists gate on a single `sync_state` row (keyed by resource) that
  carries the collection's `etag` and `fetchedAt`. Conditional (`If-None-Match` →
  304) revalidation is wired for the **repos list** and the **PR list**; the
  GraphQL PR-detail and REST files are TTL-only (no usable ETag). Mutations bust
  the relevant row to force a refetch. TTL is a `policy.ts` constant, not a column
  (the old write-only `staleAfter`/`etag` columns are dropped).
- **Provider resources** (`issues` + optional `sync_state`): item detail uses each issue row's
  `fetchedAt`; a provider collection with no natural row when empty (Rollbar's item list) uses an
  opaque connection-scoped `sync_state` key. Disconnect removes both the issue rows and matching
  provider sync keys.

The `fetchedAt` columns on `repos`/`pull_requests` remain the prune key for the
atomic mirror rewrites and a pre-ETag fallback for the repos list.

One accepted staleness hole, by decision: `resolveRepoForUser` (`routes/repoMirror.ts`) serves a
cached repo row with **no TTL check** on the resolve path — repo rows only refresh via the
repos-list refresh, so a renamed/transferred repo keeps resolving to its old `repoId` until that
list refresh replaces it. Cheap resolves on every PR route beat a per-resolve TTL for metadata
that almost never changes.

App-state tables have **no** staleness columns — acorn owns them, so there is nothing to revalidate.
Exact TTL values and the ETag/304 flow are in [caching](./caching.md).

## Patch bodies live in the BLOBS cache

`pr_files` rows carry only file metadata and the blob `sha`. The actual patch/file bodies —
immutable, addressable by sha — live in the on-disk `BLOBS` directory
(`blobs/` in the node's data root), not in SQLite, under two key prefixes owned by
`packages/node-core/src/server/blobs.ts`: `patch:<sha>` (written by `routes/prMirror.ts`) and `filebody:<sha>` for
full file bodies (`routes/pullBlob.ts`). This keeps
the DB small and lets identical blobs across PRs share one cached body. (The old
`if (!repoRow.private)` public/private guard around blob caching has been **removed** — every body
caches locally.) See [caching](./caching.md).

## Schema-change workflow

Drizzle Kit is **generate-only** (`drizzle.config.ts`): it emits SQL from the schema and never
connects to a database.

```ts
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/server/db/schema.ts',
  out: './migrations',
})
```

Workflow:

```bash
# 1. edit packages/node-core/src/server/db/schema.ts
pnpm db:generate   # drizzle-kit generate → new SQL in packages/node-core/migrations/, then replay-check
pnpm db:migrate    # tsx scripts/migrate.ts → apply (also runs on app startup)
```

After changing the **bindings** shape, update the exported `Env`/`RuntimeBindings` in
`packages/node-core/src/main/bindings.ts`.

Migrations live in `packages/node-core/migrations/` (`0000_*.sql` … `0038_*.sql` at time of writing, plus a
`meta/` snapshot dir) and are applied by `drizzle-orm/better-sqlite3/migrator` — automatically on app
startup (`openDb` in `packages/node-core/src/main/bindings.ts`) and via `db:migrate`.

**Gotchas:**

- **NOT-NULL rebuild:** adding a `NOT NULL` column to a populated table makes Drizzle emit a
  table-rebuild migration whose `INSERT … SELECT` copy must be trimmed by hand. See
  [local-development](./local-development.md).
- **FTS5 virtual tables** (`memories_fts`) are invisible to Drizzle — it neither generates nor
  migrates them. `CREATE VIRTUAL TABLE` lives hand-written in migration `0011`; if the indexed
  columns change, edit the migration/DDL yourself and keep the sync code in step.
- **better-sqlite3 ABI:** `db:migrate` runs under plain Node, so it needs the Node ABI build
  (`pnpm rebuild:node`); Electron needs the Electron ABI. See the root
  `CLAUDE.md`.

---

**See also:** [architecture-overview](./architecture-overview.md) ·
[caching](./caching.md) · [github-integration](./github-integration.md) ·
[integrations](./integrations.md) · [workspaces-and-tasks](./workspaces-and-tasks.md) ·
[notes-and-memory](./notes-and-memory.md) · [workflows](./workflows.md) ·
[terminal-and-agents](./terminal-and-agents.md) · [electron](./electron.md) ·
[local-development](./local-development.md)
