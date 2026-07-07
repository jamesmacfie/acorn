# Data Layer

The local SQLite database: 28 [Drizzle ORM](https://orm.drizzle.team/) tables (plus one hand-written
FTS5 virtual table) that back everything acorn shows — the GitHub read-model mirror and acorn's own
app-state.

> **Runtime note:** acorn migrated from Cloudflare Workers to a local Electron app (see
> [electron.md](./electron.md)). The read-model mirror is unchanged but now lives in local SQLite
> (better-sqlite3 + Drizzle) under `apps/desktop/.acorn/`, not D1. `db.batch()` is emulated via a
> transaction (electron.md §4c). Read any lingering "D1" as "the local SQLite DB".

The schema is three classes of table:

- **Mirror tables** — cached projections of GitHub (and, generically, of external issue providers)
  data. Disposable, revalidated, populated on read. The SQLite mirror is a *cache of GitHub, not a
  source of truth* (see [architecture-overview](./architecture-overview.md)).
- **App-state tables, GitHub-scoped** — data GitHub does not have but which is *about* a GitHub user:
  prefs, pins, viewed-file checkboxes, integration credentials. Keyed by `userId`; acorn owns them.
- **App-state tables, machine-scoped** — data that describes *this machine* (local checkouts,
  worktrees, tasks, terminals, notes, memory). No `userId` — they exist outside any GitHub user
  context. acorn owns them.

Source: `apps/desktop/src/server/db/schema.ts` (fully commented — the source of truth for every
column), `apps/desktop/src/server/db/index.ts`, `apps/desktop/src/server/db/resourceKeys.ts`,
`apps/desktop/migrations/`.

## Drizzle client

```ts
export const getDb = (env: Env): AppDatabase => env.DB
```

`env.DB` is the better-sqlite3 Drizzle client, built once at startup in
`apps/desktop/src/main/bindings.ts` (with an emulated `.batch()`, since better-sqlite3 has no native
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
`userId`. They describe the local filesystem and the user's work on it — the terminal service in the
Electron main process reads them outside any GitHub user context, and on a single-user machine there
is no second user to isolate from. See [user- vs machine-scoping](#user--vs-machine-scoping) below.

Patch/blob bodies are the one thing kept outside the tables entirely: the on-disk `BLOBS` cache
(under `apps/desktop/.acorn/blobs/`) holds immutable bodies keyed by sha. On a single-user machine
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
| `fetchedAt` | integer | epoch ms; staleness base — the route compares against `REPOS_STALE_AFTER_MS` |

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
| `provider` | text | `linear` \| `rollbar` (denormalized from the integration) |
| `identifier` | text | e.g. `ENG-123` |
| `data` | text | JSON issue detail — a single blob so a provider's shape can evolve without migrations |
| `fetchedAt` | integer | epoch ms; TTL base (Linear: 10 min, `routes/linear.ts`; Rollbar: 2 min, `routes/rollbar.ts` — see [caching](./caching.md)) |

### Group 2 — App-state tables, GitHub-scoped (per-user)

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

Per-user key→value preferences. PK `(userId, key)`. `GET /api/prefs` returns a key→value map; `PUT`
upserts one key.

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
| `provider` | text | `linear` \| `rollbar` |
| `label` | text | user-facing name, seeded from the provider (workspace/org) |
| `accessToken` | text | **encrypted at rest** (JWE via `SESSION_ENC_KEY`, `session.ts` `encryptSecret`); never leaves the server — same posture as the GitHub token |
| `meta` | text | optional JSON (e.g. `{ workspace }`, base url, org id) |
| `createdAt` | integer | epoch ms |

> GitHub itself is **not** stored here: it is the identity root (its token is the session cookie,
> `userId` derives from it). It only *appears* as a synthesized entry in the integrations list
> endpoint. See [integrations](./integrations.md), [authentication](./authentication.md).

### Group 3 — App-state tables, machine-scoped (no userId)

These describe the local machine and the user's work on it. No `userId` (single-user machine). acorn
is the source of truth. Several belong to flag-gated or design-stage features — noted per table.

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
| `createdAt`, `updatedAt` | integer | epoch ms |

#### `workspaces`

A **Workspace** is a named *group of repos* ("Runn", "Acorn") — the top-level unit selected in the
top bar (see [workspaces-and-tasks](./workspaces-and-tasks.md)). PK opaque `id`. Machine-scoped.

| Column | Type | Note |
| --- | --- | --- |
| `id` | text (PK) | opaque uuid |
| `name` | text | editable label |
| `isDefault` | boolean | the catch-all group |
| `sort` | integer | selector ordering |
| `setupScript` | text | shell run once when a task worktree is created; null/blank = none |
| `setupScriptTrigger` | text | `off` \| `created` \| `terminal` — when to run it; null → `terminal` |
| `devScript` | text | per-workspace "run dev" → a `dev` run target; null/blank = no run button |
| `devRestartScript` | text | restart command for the `dev` target; when set, `run_restart` uses it instead of stop+start |
| `teardownScript` | text | shell run in the worktree just before removal (docs/terminal-and-agents.md); null/blank = none |
| `previewMode` | text | `url` \| `port` \| `script` — how the browser-preview URL resolves; null → dev-server port |
| `previewValue` | text | the URL/port/command per `previewMode`; null/blank = unset |
| `icon` | text | JSON `WorkspaceIcon` (`emoji`/`lucide`/`github`); null → derived default |
| `color` | text | preset token key or 6-hex; null → derived from name hash |
| `createdAt`, `updatedAt` | integer | epoch ms |

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

Repos the user has hidden from workspaces. PK `(owner, repo)`. An ignored repo has no
`workspace_repos` row, so it is excluded from the selector/rail/scoping; the onboarding modal still
lists it (it iterates all mirrored repos) so it can be reassigned. Bootstrap skips ignored repos so
they don't silently reappear in Default.

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
| `origin` | text | `github-pr` \| `linear` \| `rollbar` \| `local` |
| `repoOwner`, `repoName` | text | a task always belongs to a repo |
| `branch` | text | the branch this task works on |
| `worktreePath` | text | null until a terminal is first opened |
| `pullNumber` | integer | null for local-first until a PR is inherited |
| `status` | text | `active` \| `archived` |
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
| `provider` | text | `linear` \| `rollbar` (denormalized) |
| `identifier` | text | `ENG-42` \| rollbar item id |
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

#### `terminal_sessions`

Durable terminal sessions. PK opaque `id`. Machine-scoped. **Desktop-only** — the terminal drawer
requires the preload bridge and is always on in the Electron app (`capabilities()`,
`apps/desktop/src/client/features/capabilities.ts`).
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

The durable checkpoint for the main-process workflow state machine — every transition is persisted so
a run survives an app restart. PK opaque `id`. Machine-scoped. **Design-stage / in progress**: real
scaffolding exists (schema, `run_*`/gate harness routes, read-only WorkflowsSettings inspector,
palette entries) but there is no finished orchestrator; gated with the terminal flag. See
[workflows](./workflows.md).

| Column | Type | Note |
| --- | --- | --- |
| `id` | text (PK) | |
| `taskId` | text | → `tasks.id` (the worktree/agent scope) |
| `name` | text | |
| `status` | text | `running` \| `gated` \| `done` \| `failed` \| `safety-rail` |
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
| `kind` | text | `agent`\|`gate-human`\|`gate-policy`\|`ci-loop`\|`fan-out`\|`join` (default `agent`) |
| `mode` | text | `headless` \| `interactive` (default `headless`) |
| `profileId`, `model` | text | |
| `status` | text | `pending`\|`running`\|`waiting-gate`\|`done`\|`failed`\|`skipped` |
| `worktreePath` | text | first-class working context |
| `inputsJson` | text | the assembled bundle handed to the step |
| `resultJson` | text | captured `HeadlessResult` (sans events) |
| `structuredJson` | text | schema-conforming output — the edge currency |
| `sessionId` | text | for `--resume` (open in terminal) |
| `costUsd` | real | |
| `iteration` | integer | loop-bound bookkeeping (default 0) |
| `parentStepId` | text | fan-out lineage |
| `error` | text | |
| `createdAt`, `updatedAt` | integer | epoch ms |

---

## Relationships

There are no foreign-key constraints in SQLite here — relationships are by convention (shared key
columns) and enforced in application code (e.g. `cascadeDeleteIntegration` in
`src/server/db/cascade.ts` for disconnecting an integration). Accordingly `openDb`
(`src/main/bindings.ts`) sets no `foreign_keys` pragma — with no declared `references()` it would
be a no-op implying enforcement this doc explicitly says doesn't exist. The important joins:

**GitHub mirror hierarchy.** `repos (userId, id)` ← `pull_requests (userId, repoId, number)` ← the
PR-detail children, each keyed `(userId, repoId, number, …)`:

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

**`sync_state` resource keys** (`apps/desktop/src/server/db/resourceKeys.ts`) gate the collections
that have no natural per-row freshness home:

| Key | Builder | Gates |
| --- | --- | --- |
| `pulls:<repoId>:<open\|closed>` | `pullsResource` | a PR-list page for a repo/state |
| `pr:<repoId>:<number>` | `prResource` | one PR's whole detail composite (all children above) |
| `files:<repoId>:<number>` | `filesResource` | the PR's changed-files list |

**Workspace ↔ repos ↔ path.** A workspace groups repos; the local checkout is stored separately and
joined by owner/name:

```
workspaces(id)
  └─ workspace_repos(workspaceId, repoOwner, repoName)   -- one workspace per repo (partition)
        └─ repo_paths(owner=repoOwner, repo=repoName)     -- this machine's checkout + run config
  └─ workspace_projects(workspaceId, integrationId, externalId)  -- linked external projects
ignored_repos(owner, repo)   -- repos with NO workspace_repos row (hidden)
```

**Task graph.** A task is the hub for local work; its dependents point at `tasks.id`:

```
tasks(id)
  ├─ task_links(taskId, integrationId, identifier)   -- (integrationId, identifier) → issues PK tail
  ├─ review_notes(taskId)
  ├─ terminal_sessions(taskId)
  └─ workflow_runs(taskId)
        └─ workflow_steps(runId)                     -- workflow_steps.parentStepId = fan-out lineage
tasks.parentId → tasks.id                            -- task tree (fan-out children)
```

**Integrations fan-out.** `integrations.id` is referenced by `issues`, `task_links`,
`workspace_projects` (and `integrations.provider` is denormalized onto `issues`/`task_links` for cheap
filtering). `task_links (integrationId, identifier)` deliberately matches the tail of the `issues` PK
`(userId, integrationId, identifier)`, so a task's external link resolves straight to cached issue
detail without a lookup table.

---

## User- vs machine-scoping

Why some tables have `userId` and some do not:

- **`userId` present** (mirror + GitHub-scoped app-state): the data belongs to a GitHub identity and
  must obey the public/private rule — a private repo's mirror or a user's viewed-file state must never
  cross users, so `userId` is part of the PK.
- **`userId` absent** (machine-scoped app-state): the data describes *this machine* — a local
  checkout path (`repo_paths`), a worktree-backed task (`tasks`), a tmux session
  (`terminal_sessions`), a memory file on disk (`memories`). It is read by the Electron main process
  and the terminal service, which run outside any GitHub request context. On a single-user machine
  there is no second user to isolate from, so adding `userId` would be dead weight.

`integrations` sits on the GitHub-scoped side (a user's third-party credentials), but its dependents
that describe local work — `task_links`, `workspace_projects` — reference it by `integrationId` from
the machine-scoped side. This is the one place the two scopes meet by key.

## Staleness / ETag bookkeeping

Two freshness patterns coexist:

- **Per-row** (`repos`, `pull_requests`): a row is stale when `now > fetchedAt + TTL`; the TTL is a
  route constant, not a column (the old write-only `staleAfter`/`etag` columns are dropped).
  Conditional (`If-None-Match` → 304) revalidation is wired for the PR list only, via `sync_state`.
- **Per-collection** (`sync_state`): the PR-detail children and the PR/file lists have no per-row
  staleness. A single `sync_state` row (keyed by resource, above) carries the collection's `etag` and
  `fetchedAt` and gates the whole set. Mutations bust the relevant row to force a refetch.
- **TTL only** (`issues`): serve-then-revalidate by `fetchedAt` age; no ETag.

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
(`apps/desktop/.acorn/blobs/`), not in SQLite, under two key prefixes owned by
`src/server/blobs.ts`: `patch:<sha>` (written by `routes/prMirror.ts`) and `filebody:<sha>` for
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
# 1. edit apps/desktop/src/server/db/schema.ts
pnpm --filter @acorn/desktop db:generate   # drizzle-kit generate → new SQL in apps/desktop/migrations/
pnpm --filter @acorn/desktop db:migrate    # tsx scripts/migrate.ts → apply (also runs on app startup)
```

After changing the **bindings** shape, update the hand-written `Env` in `apps/desktop/src/env.d.ts`.

Migrations live in `apps/desktop/migrations/` (`0000_*.sql` … `0015_*.sql` at time of writing, plus a
`meta/` snapshot dir) and are applied by `drizzle-orm/better-sqlite3/migrator` — automatically on app
startup (`openDb` in `apps/desktop/src/main/bindings.ts`) and via `db:migrate`.

**Gotchas:**

- **NOT-NULL rebuild:** adding a `NOT NULL` column to a populated table makes Drizzle emit a
  table-rebuild migration whose `INSERT … SELECT` copy must be trimmed by hand. See
  [local-development](./local-development.md).
- **FTS5 virtual tables** (`memories_fts`) are invisible to Drizzle — it neither generates nor
  migrates them. `CREATE VIRTUAL TABLE` lives hand-written in migration `0011`; if the indexed
  columns change, edit the migration/DDL yourself and keep the sync code in step.
- **better-sqlite3 ABI:** `db:migrate` runs under plain Node, so it needs the Node ABI build
  (`pnpm --filter @acorn/desktop node:rebuild`); Electron needs the Electron ABI. See the root
  `CLAUDE.md`.

---

**See also:** [architecture-overview](./architecture-overview.md) ·
[caching](./caching.md) · [github-integration](./github-integration.md) ·
[integrations](./integrations.md) · [workspaces-and-tasks](./workspaces-and-tasks.md) ·
[notes-and-memory](./notes-and-memory.md) · [workflows](./workflows.md) ·
[terminal-and-agents](./terminal-and-agents.md) · [electron](./electron.md) ·
[local-development](./local-development.md)

