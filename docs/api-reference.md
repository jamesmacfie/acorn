# API Reference

The server's complete HTTP surface. One Hono app (`apps/desktop/src/core/server/index.ts`, a
`createApp()` factory) serves both `/auth/*` and `/api/*`, hosted in-process by `@hono/node-server`
on `http://127.0.0.1:4317`. The Electron main process (`apps/desktop/src/core/main/server.ts`) wraps it
with static-asset serving + SPA fallback. See [architecture-overview](./architecture-overview.md)
and [electron](./electron.md).

> **History:** acorn began as a Cloudflare Worker; the HTTP surface carried over unchanged when it
> migrated to Electron. Some inline code comments still say "the Worker" / "D1 / KV" — read those as
> "the local server" / "local SQLite" / "the on-disk blob dir".

> **Phase 3 (transport collapse):** the renderer↔main IPC channels are now HTTP routes + one
> WebSocket, not `ipcMain` handlers. New route families: `/api/tasks/:id/{search,editor/*,local/*,
> database/*}`, `/api/terminal/*` + `/api/tasks/:id/{archive,preview-url,on-created,use-checkout,
> mcp}`, `/api/tasks/:id/workflows` + `/api/workflows/runs/:runId/*`, `/api/memory*` +
> `/api/workspaces/:wsId/notes*`, `/api/tasks/:id/notes*`, and the `RunBridge` at `/api/tasks/:id/run/*`. Each is
> backed by a main-process **bridge** (`server/bridge.ts`; 503 `bridge-unavailable` when unwired).
> Live streams (PTY output/input, session status, workflow notices) ride one authenticated
> WebSocket at `/ws` — see [electron.md §12](./electron.md) for the transport + `dev:node`
> capability map.

## Middleware & auth

Every `/api/*` route runs through three middlewares before the handler, in this exact order
(`apps/desktop/src/core/server/index.ts`):

1. `csrf()` — Origin / `Sec-Fetch-Site` check on mutating calls.
2. `authMiddleware` (`apps/desktop/src/core/server/middleware/auth.ts`) — resolves a **`Principal`**
   (`{ kind, user }`) plus the raw `ctx.user` (or `null`) from **either** of two credentials:
   - the AES-256-GCM session **cookie** (decrypted in-CPU, then re-sealed with a sliding TTL) →
     `kind: 'user'`; or
   - the internal-loopback header **`x-acorn-internal: <INTERNAL_TOKEN>`** → `kind: 'internal'`.
     This is the acorn MCP server calling over loopback — it holds no cookie. `INTERNAL_TOKEN` is a
     fresh `randomUUID()` per app run (`apps/desktop/src/core/main/bindings.ts`), injected into task
     terminal sessions as `ACORN_API_TOKEN`. The identity is the machine's single user (resolved
     from the mirror's `prefs`/`repos` rows), and its GitHub token is left **empty**, so internal
     callers can only read local mirrors — a live GitHub call with the empty token would just come
     back `401 reauth`.
3. `requireUser` (`apps/desktop/src/core/server/middleware/requireUser.ts`) — the single auth gate.
   It rejects any request with no resolved principal → `401 { error: 'unauthenticated' }`. Routes
   no longer carry inline session guards; handlers read the identity via `getUser(c)` (safe because
   the gate guarantees a principal). Gating on the principal, not on "a cookie is present," keeps a
   future authorized external caller a new `kind` rather than a per-route change
   ([docs/next/security.md](./next/security.md) §9.1).

`/auth/*` routes bypass this chain (they establish the session) and are unauthenticated by
construction — they mount *before* the `/api/*` middlewares. See
[authentication](./authentication.md).

## Conventions

- All responses are JSON unless noted (`/auth/*` errors are plain text). Timestamps are epoch
  **milliseconds**.
- **Error envelope:** every `/api/*` error body is `ApiError` — `{ error: string; detail?: string[] }`
  (`apps/desktop/src/core/shared/api.ts`) — built by one server helper, `respondError(c, status, code, detail?)`
  (`apps/desktop/src/core/server/respond.ts`). `error` is a stable machine code (see
  [Error codes](#error-codes)); `detail` carries human/upstream prose (GraphQL messages, GitHub's
  422 text, harness failure messages). There is no second error shape — no body-level `status`, no
  `{ kind }`, no prose in `error`.
- Success **response mappers** are checked against the shared response types with `satisfies`
  (`apps/desktop/src/core/shared/api.ts`), so adding a required field to a response type fails
  `pnpm lint` at every mapper that omits it.
- Reads return public projections (no `userId`, no staleness columns, no token).
- Mutating requests take a JSON body.
- **Repo resolution:** mirror-backed repo-scoped **reads** (`pulls`, `pullDetail`, `pullFiles`,
  `pullsBatch`, `repoLabels`) resolve `:owner/:repo` via `resolveRepoForUser`
  (`routes/repoMirror.ts`) — a mirror miss falls back to a live `GET /repos/{owner}/{repo}` and
  mirrors the row; a GitHub `404` *or plain `403`* maps to `404 repo_not_found`. PR **writes**
  (`prActions.ts` via `prContext.ts`) resolve the mirror only — they never fetch the repo live.
- **Source** column (used in the tables below):
  - **Mirror** — served from the local SQLite read-model (serve-then-revalidate; may fire a
    background GitHub call to refresh). See [data-layer](./data-layer.md), [caching](./caching.md).
  - **GitHub** — a live GitHub REST/GraphQL call on the request path.
  - **App-state** — local SQLite where acorn is the source of truth (no GitHub involved).
  - **Bridge** — proxied to the main-process per-domain harness bridges (returns `503` when unavailable).
  - **Provider** — a live third-party (Linear/Rollbar) call, cached locally.

## Shared client contract

The SPA uses a small shared TypeScript contract rather than a runtime RPC client.
`apps/desktop/src/core/shared/api.ts` owns response types, route builders, and query-key factories;
`apps/desktop/src/core/client/queries.ts` and `mutations.ts` consume those helpers with plain same-origin
`fetch`. That keeps the client bundle thin and preserves the exact request shape of the HTTP API: no
generated client, no extra network calls, no runtime wrapper on the hot read paths.
`apps/desktop/src/core/shared/api.test.ts` characterizes the route strings and query-key shapes so cache
compatibility does not drift.

---

## Auth routes (`/auth`)

`apps/desktop/src/core/server/routes/auth.ts`. The GitHub OAuth web flow; the token is sealed into the
session cookie and never reaches the browser.

| Method | Path | Purpose | Source |
| --- | --- | --- | --- |
| `GET` | `/auth/login` | Mint OAuth state (in-memory map + short-lived cookie), redirect to GitHub authorize. `?return_to=` deep-link is preserved (relative-only, open-redirect guarded). | GitHub |
| `GET` | `/auth/permissions` | Redirect to the GitHub OAuth app's settings/connections page. | — |
| `GET` | `/auth/callback` | Validate state (cookie + one-time server state), exchange `code` for a token, fetch `/user`, seal the session, redirect to `return_to`. | GitHub |
| `POST` | `/auth/logout` | Clear session cookies → `204`. | — |

`/auth/callback` errors: `400` (missing `code`/`state`), `403 invalid state` (cookie mismatch or
consumed/expired state). Token-exchange or profile-fetch failure redirects back to `/auth/login`.
Full flow in [authentication](./authentication.md).

---

## `GET /api/me`

`apps/desktop/src/core/server/routes/me.ts`. Current user, public fields only (no token). Session-only,
no DB read.

```ts
200 → { login: string, name: string, avatar: string, scopes: string[] }
401 → { error: 'unauthenticated' }   // valid logged-out state; client returns null
```

---

## Pins (`/api/pins`)

`apps/desktop/src/core/server/routes/pins.ts`. Pinned repos for the selector — **App-state**, user-scoped.

### `GET /api/pins`

This user's pinned repo ids, in pin order (the `sort` column, ascending — a new pin appends at
`max(sort) + 1`).

```ts
200 → number[]
401 → { error: 'unauthenticated' }
```

### `PUT /api/pins`

Pin or unpin one repo. Body `{ repoId: number, pinned: boolean }`.

```ts
200 → { repoId, pinned }
400 → { error: 'bad_request' }
```

---

## Prefs (`/api/prefs`)

`apps/desktop/src/core/server/routes/prefs.ts`. App-state preferences (theme, diff view mode, …) —
user-scoped key→value store.

### `GET /api/prefs`

```ts
200 → Record<string, string>
```

### `PUT /api/prefs`

Upsert one preference. Body `{ key: string, value: string }`.

```ts
200 → { key, value }
400 → { error: 'bad_request' }
```

---

## Workspaces (`/api/workspaces`)

`apps/desktop/src/core/server/routes/workspaces.ts`. A **Workspace** is a named group of repos — the
top-level unit. All routes are **App-state** (machine-scoped tables `workspaces`, `workspace_repos`,
`ignored_repos`, `workspace_projects`); `bootstrap` and `ignore-all` also read the repos **Mirror**.
See [workspaces-and-tasks](./workspaces-and-tasks.md).

| Method | Path | Purpose | Body / params |
| --- | --- | --- | --- |
| `GET` | `/api/workspaces` | List workspaces with their (non-ignored) repos, ordered by `sort`. | — |
| `POST` | `/api/workspaces/bootstrap` | Idempotent first-run: create `Default`, assign every mirrored repo not yet in a workspace. Returns the full list. | — |
| `POST` | `/api/workspaces` | Create a workspace. | `{ name }` → `Workspace` |
| `PATCH` | `/api/workspaces/:id` | Update name / setup+dev+devRestart+teardown scripts / trigger / browser-preview mode+value / icon / color. Blank string ⇒ `null`; `null` clears to derived default. `port` preview values must be a bare 1–65535 port (open-redirect guard). `404` on unknown ids. | partial `Workspace` fields |
| `DELETE` | `/api/workspaces/:id` | Delete; its repos are reassigned to `Default`, its project links dropped. `Default` cannot be deleted. | — |
| `POST` | `/api/workspaces/:id/repos` | Move a repo into this workspace (partition upsert on `(owner,name)`); clears any ignore flag. | `{ owner, name, sort? }` |
| `GET` | `/api/workspaces/assignments` | Per-repo assignment map for onboarding: `{ owner, name, workspaceId, ignored }[]`. | — |
| `POST` | `/api/workspaces/ignore-repo` | Hide a repo (keeps membership, flags it ignored). | `{ owner, name }` |
| `POST` | `/api/workspaces/unignore-repo` | Un-hide a repo. | `{ owner, name }` |
| `POST` | `/api/workspaces/ignore-all` | Hide / show every mirrored repo at once (onboarding master toggle). | `{ ignored: boolean }` |
| `GET` | `/api/workspaces/:id/projects` | This workspace's linked external projects. | → `{ projects: { integrationId, externalId }[] }` |
| `PUT` | `/api/workspaces/:id/projects` | Replace the whole linked-project set. | `{ projects: { integrationId, externalId }[] }` |

Common errors: `401 unauthenticated`; `400 bad_request` (blank name, bad trigger/preview/icon/color,
or a `PATCH` body with no recognized field); `404 not_found` and `400 cannot_delete_default` on
`DELETE`. Validated writes return `{ ok: true }`. Note `PATCH /:id` is a blind update — an unknown
id still returns `{ ok: true }` (no `404`).

---

## Tasks (`/api/tasks`)

A **Task** is the single-repo unit of work. This mount is served by four routers.

### CRUD — `apps/desktop/src/core/server/routes/tasks.ts`

All **App-state** (machine-scoped `tasks` / `task_links`). Worktree teardown on archive is the main
process's job; these routes only flip DB rows.

| Method | Path | Purpose | Body / params |
| --- | --- | --- | --- |
| `GET` | `/api/tasks` | List `active` tasks (with links), ordered by `sort`. | → `Task[]` |
| `POST` | `/api/tasks` | Create a task (title auto-seeded if absent: `#<pull> <repo>` or `<repo> · <branch>`; birth links accepted via `links`). | `TaskSeed` → `Task` |
| `PATCH` | `/api/tasks/:id` | Rename and/or set `status` (`active`\|`archived`; stamps `archivedAt`). `404` on unknown ids. | `{ title?, status? }` |
| `POST` | `/api/tasks/:id/links` | Add an external link (idempotent; `404` if task missing). | `TaskLink` |
| `DELETE` | `/api/tasks/:id/links` | Remove a link by `(integrationId, identifier)`. | `{ integrationId, identifier }` |

`POST /` requires `origin`, `repoOwner`, `repoName`, `branch`; it and `POST /:id/links` return
`400 bad_request` on missing required fields.

### Review notes — `apps/desktop/src/plugins/changes/server/routes/reviewNotes.ts`

Local inline annotations on uncommitted changes, acorn-owned (**App-state**, `review_notes`). The
send loop: create (unsent) → deliver → `POST /sent` stamps `sentAt` → an edit clears it.

| Method | Path | Purpose | Body / params |
| --- | --- | --- | --- |
| `GET` | `/api/tasks/:id/review-notes` | List a task's notes, oldest first. | → `ReviewNote[]` |
| `POST` | `/api/tasks/:id/review-notes` | Create a note (`404` if task missing). | `ReviewNoteSeed` → `ReviewNote` |
| `PATCH` | `/api/tasks/:id/review-notes/:noteId` | Edit body; clears `sentAt`. | `{ body }` |
| `DELETE` | `/api/tasks/:id/review-notes/:noteId` | Delete a note. | — |
| `POST` | `/api/tasks/:id/review-notes/sent` | Stamp `sentAt` on the given note ids (delivery confirmation). | `{ ids: string[] }` |

`400 bad_request` on invalid path/side/lines/body or empty id list. `side` is
`'additions' | 'deletions'` (diff-pane sides, not GitHub's `LEFT`/`RIGHT`); `endLine` defaults to
`startLine`.

### Task context — `apps/desktop/src/core/server/routes/taskContext.ts`

The context assembler — never a live GitHub call, so the agent sees the same picture as the UI.
The contribution registry assembles PR/issues from the **Mirror** and notes/memory from main-process
stores. The response carries serialized section metadata/items/compact text; `include=*` returns the
inventory for the Context pane, while an omitted include uses contribution defaults.

| Method | Path | Purpose | Params |
| --- | --- | --- | --- |
| `GET` | `/api/tasks/:id/repo-info` | Repo facts for the MCP `repo_info` tool: `{ owner, name, defaultBranch, branch, worktreePath }`. | — |
| `GET` | `/api/tasks/:id/context` | Assembled `TaskContext` and projected sections. | `?include=<section ids>`; internal workflow assembly also passes `workflowRunId` to exclude other runs' handoffs |

`404 not_found` when the task id is unknown.

### Agent-tool projection — `apps/desktop/src/core/server/routes/agentTools.ts`

The registry is installed by the main-process composition root. MCP/harness paths require the
per-run internal principal; renderer projection is a separate cookie-authenticated opt-in path.
Missing registries return `503 bridge-unavailable`; hidden, unavailable, or non-renderer tools are
indistinguishable `404 not_found` responses.

| Method | Path | Purpose | Body / params |
| --- | --- | --- | --- |
| `GET` | `/api/tasks/:id/tools` | Available MCP manifest with draft-07 input schemas. | internal token |
| `POST` | `/api/tasks/:id/tools/:name` | Validate and invoke an agent tool. | contribution-owned JSON; internal token |
| `POST` | `/api/tasks/:id/renderer-tools/:name` | Invoke an `exposeToRenderer` contribution. | contribution-owned JSON; session cookie |
| `GET` | `/api/agent-tools` | Static name/description/risk/availability catalog for Settings. | session cookie |
| `GET/POST` | `/api/tasks/:id/notes[/:slug]` | Task-scoped renderer note CRUD; PUT/DELETE and `/included` also apply. | note body/title/included shape |
| `GET/POST` | `/api/workspaces/:wsId/notes[/:slug]` | Workspace note CRUD; reserved `wsId=global` addresses global notes. | note body/title/included shape |
| `GET` | `/api/tasks/:id/run` | List run targets for the task. | — |
| `POST` | `/api/tasks/:id/run/:target/start` | Start a run target. | — |
| `POST` | `/api/tasks/:id/run/:target/stop` | Stop a run target. | — |
| `POST` | `/api/tasks/:id/run/:target/restart` | Restart a run target. | — |
| `GET` | `/api/tasks/:id/run/:target/status` | Run-target status. | — |

The remaining `/run/*` rows are renderer routes backed by `RunBridge`; agent-facing run/browser,
notes, memory, context, and git verbs go through `/tools/:name`.

### Workflow control — `apps/desktop/src/plugins/workflows/server/routes/workflow.ts`

The desktop main process installs the durable runner behind this bridge. Definitions and controls
use HTTP; live notices, status pings, and step events use the authenticated WebSocket.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/tasks/:id/workflows` | Load validated repo/user workflow definitions plus named parse errors. |
| `POST` | `/api/tasks/:id/workflows` | Validate and start `{ def }`; returns `{ runId }` or a named validation error. |
| `GET` | `/api/tasks/:id/workflows/runs` | List durable runs for a task. |
| `GET` | `/api/workflows/runs/:runId/steps` | List top-level/fan-out step rows with a profile-projected resume command when available. |
| `POST` | `/api/workflows/runs/:runId/gate` | Resolve a waiting human gate with `{ stepId, approved }`. |
| `POST` | `/api/workflows/runs/:runId/cancel` | Cancel the run tree and abort active handlers. |
| `POST` | `/api/workflows/runs/:runId/kill` | Kill one running step with `{ stepId }`. |
| `POST` | `/api/workflows/triggers/poll` | Evaluate registered trigger predicates on the app-open client poll tick. |

---

## Integrations (`/api/integrations`)

`apps/desktop/src/core/server/routes/integrations.ts`. List/connect/disconnect third-party providers.
Multi-row per provider; GitHub is a **synthesized** entry (id `github`) whose token is the session
cookie, not a stored row. Connecting validates the pasted token **live** against the provider, then
stores it encrypted (`encryptSecret`) — **App-state** otherwise.

| Method | Path | Purpose | Body |
| --- | --- | --- | --- |
| `GET` | `/api/integrations` | Public provider catalog plus synthesized/stored connection summaries. | → `{ providers, integrations }` |
| `POST` | `/api/integrations` | Descriptor-driven validate/normalize/encrypt/store. | `{ providerId, credentials }` → `{ integration }` |
| `PUT` | `/api/integrations/:id` | Rotate credentials while preserving connection identity and linked state. | `{ credentials }` |
| `POST` | `/api/integrations/:id/test` | Test health and update connection status. | — |
| `PATCH` | `/api/integrations/:id` | Disable/re-enable without deleting linked state. | `{ disabled }` |
| `DELETE` | `/api/integrations/:id` | Disconnect; cascades workspace bindings, cached issues, and task links → `204`. | — |

Errors use the generic `provider_*` taxonomy listed below. See [integrations](./integrations.md).

---

## Linear (`/api/linear`)

`apps/desktop/src/plugins/linear/server/routes/linear.ts`. Reads Linear (**Provider** — live
GraphQL), cached per-user into the generic `issues` table (serve-then-revalidate, 10-min TTL). A bare
identifier is resolved across every connected Linear connection (first-hit-wins); browse routes take
an explicit `?integration=<id>`.

| Method | Path | Purpose | Body / params |
| --- | --- | --- | --- |
| `GET` | `/api/linear/projects` | Projects across every connected Linear, each tagged with its connection. | → `{ projects: LinearProject[] }` |
| `GET` | `/api/linear/project-issues` | Active issues for project ids within one connection. | `?integration=<id>&ids=a,b` |
| `POST` | `/api/linear/issues` | Batch enrichment for referenced tickets → summaries (STR, cached). | `{ identifiers: string[] }` → `{ issues }` |
| `GET` | `/api/linear/issues/:identifier` | Full detail for the side panel. | `?refresh=1`; task-scoped reads also pass `&integration=<connectionId>` |
| `POST` | `/api/linear/issues/:identifier/comments` | Add a comment (or threaded reply via `parentId`). | `?integration=<connectionId>` for task links; `{ body, parentId? }` |

Errors: `provider_not_connected`, `provider_needs_auth`, `provider_resource_not_found`,
`provider_unavailable`, plus `bad_request` for malformed comment bodies.

---

## Rollbar (`/api/rollbar`)

`apps/desktop/src/plugins/rollbar/server/routes/rollbar.ts`. The Rollbar Source's reads (**Provider** — live REST),
cached into `issues` (provider `rollbar`, identifier = the visible counter) with serve-then-revalidate
(2-min TTL). A failing connection degrades to its cache.

| Method | Path | Purpose | Params |
| --- | --- | --- | --- |
| `GET` | `/api/rollbar/items` | Recent active items across every connected Rollbar project, cached. | — |
| `GET` | `/api/rollbar/items/:identifier` | One item's detail. | `?integration=<id>` (required) |

Errors: `provider_not_connected`, `provider_needs_auth`, `provider_resource_not_found`,
`provider_unavailable`, plus `bad_request` for a missing `integration` parameter.

---

## Repos (`/api/repos`)

`apps/desktop/src/plugins/github/server/routes/repos.ts`. This user's repos — **Mirror** (serve-then-revalidate,
~5 min TTL), ordered by `pushedAt` desc.

### `GET /api/repos`

```ts
200 → Repo[]
  Repo = { id, owner, name, private, defaultBranch, pushedAt }
401 → { error: 'unauthenticated' } | { error: 'reauth' }   // reauth = GitHub 401
502 → { error: 'github_unavailable' }
```

### `POST /api/repos/refresh`

Force the next `GET /api/repos` to re-sync (sets `fetchedAt = 0`). **App-state** write.

```ts
204 (no body)
```

---

## Repo labels (`/api/repos/:owner/:repo/labels`)

`apps/desktop/src/plugins/github/server/routes/repoLabels.ts`.

### `GET /api/repos/:owner/:repo/labels`

Repo label choices for the PR label picker (**GitHub** — first 100 labels, sorted by name).

```ts
200 → { name, color }[]
401 → { error: 'unauthenticated' } | { error: 'reauth' }
404 → { error: 'repo_not_found' }
502 → { error: 'github_unavailable' }
```

---

## Pull lists (`/api/repos/:owner/:repo/pulls`)

`apps/desktop/src/plugins/github/server/routes/pulls.ts`.

### `GET /api/repos/:owner/:repo/pulls?state=open|closed`

PR list for a repo. `state` defaults to `open`.

- **`open`** — **Mirror** (serve-then-revalidate, ~45 s TTL, conditional `If-None-Match`). Ordered by
  `updatedAt` desc. `?force=true` blocks on a fresh fetch. A refresh also back-fills `pullNumber` on
  local-first tasks whose branch now has an open PR.
- **`closed`** (covers merged) — **GitHub** proxied one page at a time (`?page=`, 50/page); returns a
  paginated shape rather than a bare array.

```ts
// open
200 → Pull[]
  Pull = { number, title, state, draft, author, headRef, baseRef, updatedAt }
// closed
200 → { pulls: Pull[], nextPage: number | null }
401 → { error: 'unauthenticated' } | { error: 'reauth' }
404 → { error: 'repo_not_found' }
502 → { error: 'github_unavailable' }
```

A GitHub `304` on the open path is handled internally (re-serves the mirror); the client sees `200`.

---

## Pull detail (`/api/repos/:owner/:repo/pulls/:number`)

`apps/desktop/src/plugins/github/server/routes/pullDetail.ts`. The composite read (GraphQL; **Mirror**, ~45 s TTL,
**TTL-only** — no ETag). Mirror logic shared with the batch route (`prMirror.ts`).

```ts
200 → PullDetail
  PullDetail = {
    pull: (Pull & { body, headSha, mergeable, mergeStateStatus, autoMergeEnabled }) | null,
    labels:   { name, color }[],
    reviews:  { id, author, state, body, submittedAt }[],
    requestedReviewers: string[],
    comments: { id, author, body, createdAt }[],
    commits:  { sha, message, author, authorLogin, committedAt }[],
    checks:   { name, status, url, runId }[],
    threads:  { threadId, path, line, side, resolved, comments: ThreadComment[] }[],
  }
  ThreadComment = { id, databaseId, author, body, createdAt }
400 → { error: 'bad_number' }
401 → { error: 'unauthenticated' } | { error: 'reauth' }
404 → { error: 'repo_not_found' } | { error: 'pull_not_found' }
502 → { error: 'github_unavailable' }
       | { error: 'graphql', detail: string[] }   // GraphQL returned errors
```

A GraphQL-level error (HTTP 200 with an `errors` array) is surfaced as `502 graphql` rather than
masquerading as a `404`.

---

## Pull files (`/api/repos/:owner/:repo/pulls/:number/files`)

`apps/desktop/src/plugins/github/server/routes/pullFiles.ts`. **Mirror** (REST-backed, ~45 s TTL). Patch bodies are
cached on-disk by blob SHA (see [caching](./caching.md)); merges in per-user `viewed` state.

### `GET .../files`

```ts
200 → PullFile[]
  PullFile = { path, status, additions, deletions, sha, viewed, patch }
            // patch is null for binary / too-large / pure-rename files
```

Query params: `?summary=1` omits patch bodies (metadata only); `?path=<p>` returns just that file
(with patch — `summary` is ignored when `path` is given). `400 bad_number`,
`401 unauthenticated|reauth`, `404 repo_not_found`, `502 github_unavailable`.

### `POST .../files/patches`

Batch patch fetch for specific paths. Body `{ paths: string[] }` (max 20).

```ts
200 → PullFile[]   // ordered to match the request; [] for an empty list
400 → { error: 'bad_paths' } | { error: 'too_many_paths' }
```

---

## Pull blob (`/api/repos/:owner/:repo/blobs/:sha`)

`apps/desktop/src/plugins/github/server/routes/pullBlob.ts`. Full file body at an immutable blob SHA — used to expand
unchanged context around diff hunks. Served from the on-disk **BLOBS** cache (immutable, cached
forever); a miss hits **GitHub** (`git/blobs`) then caches.

```ts
200 → { text: string }
401 → { error: 'unauthenticated' } | { error: 'reauth' }
404 → { error: 'repo_not_found' }
502 → { error: 'github_unavailable' }
```

---

## Pull batch prefetch (`/api/repos/:owner/:repo/pulls/batch`)

`apps/desktop/src/plugins/github/server/routes/pullsBatch.ts`. Warm the mirror for several open PRs at once so client
navigation is instant. Detail is one multi-alias GraphQL call for stale PRs; files are N parallel REST
calls. Already-fresh PRs cost no GitHub calls — **Mirror** with a live top-up.

### `POST .../pulls/batch`

Body `{ numbers: number[], files?: 'full' | 'summary' | 'none' }` (max 10 numbers; `files` default
`full`).

```ts
200 → PullBatchItem[]
  PullBatchItem = { number, detail: PullDetail, files: PullFile[] }
400 → { error: 'bad_numbers' } | { error: 'bad_files_mode' }
401 → { error: 'unauthenticated' } | { error: 'reauth' }
404 → { error: 'repo_not_found' }
502 → { error: 'github_unavailable' } | { error: 'graphql', detail }
```

---

## PR write actions (`/api/repos/:owner/:repo/pulls/:number/...`)

`apps/desktop/src/plugins/github/server/routes/prActions.ts`. Each resolves the mirror PR row first (`prContext.ts`:
unknown owner/repo → `404 repo_not_found`, non-integer number → `400 bad_number`, GitHub `401` →
`401 reauth`), calls **GitHub**, then updates or busts the SQLite mirror so a within-TTL read reflects
the change. See [github-integration](./github-integration.md#write-actions).

### `POST .../merge`

Body `{ method?: 'merge' | 'squash' | 'rebase' }` (default `merge`).

```ts
200 → { state: 'merged' }
409 → { error: 'merge_failed' }   // GitHub 405 (not mergeable) or 409 (head moved)
502 → { error: 'github_unavailable' }
```

### `POST .../auto-merge` / `DELETE .../auto-merge`

Enable / disable auto-merge (GraphQL; needs the mirrored node id). Enable body
`{ method?: 'merge' | 'squash' | 'rebase' }`.

```ts
200 → { autoMergeEnabled: boolean }
409 → { error: 'node_id_unknown' }        // open the PR first to mirror its node id
422 → { error: 'auto_merge_not_allowed' } // enable only; GraphQL refused
502 → { error: 'github_unavailable' }
```

### `POST .../:action{close|reopen}`

```ts
200 → { state: 'closed' | 'open' }
502 → { error: 'github_unavailable' }
```

### `POST .../draft`

Body `{ draft?: boolean }`. GraphQL; needs the mirrored PR node id.

```ts
200 → { draft: boolean }
409 → { error: 'node_id_unknown' }
502 → { error: 'github_unavailable' }
```

### `POST .../comments`

Add a discussion comment. Body `{ body: string }`.

```ts
200 → { id, author, body, createdAt }
400 → { error: 'empty_body' }
502 → { error: 'github_unavailable' }
```

### `POST .../labels` / `DELETE .../labels`

Add or remove a label. Body `{ name: string }`. Returns the PR's full label set (mirror replaced).

```ts
200 → { name, color }[]
400 → { error: 'empty_name' }
502 → { error: 'github_unavailable' }
```

### `POST .../reviews`

Submit a PR review. Body `{ event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body? }` (`body`
required for `REQUEST_CHANGES` / `COMMENT`).

```ts
200 → { ok: true }
400 → { error: 'bad_request' } | { error: 'body_required' }
502 → { error: 'github_unavailable' }
```

### `POST .../requested-reviewers` / `DELETE .../requested-reviewers`

Request or remove a reviewer. Body `{ login: string }`. Returns the PR's full requested-reviewer set.

```ts
200 → string[]
400 → { error: 'empty_login' }
502 → { error: 'github_unavailable' }
```

### `POST .../viewed`

Toggle a file's "viewed" checkbox (**App-state**, no GitHub call). Body `{ path, viewed }`.

```ts
200 → { path, viewed }
400 → { error: 'bad_request' }
```

### `POST .../review-comments`

Start a new inline review comment on a line. Needs the mirrored head sha. Body
`{ body, path, line, side? }` (`side` default `RIGHT`).

```ts
200 → { ok: true }
400 → { error: 'bad_request' }
409 → { error: 'head_sha_unknown' }   // open the PR first to mirror head sha
502 → { error: 'github_unavailable' }
```

### `POST .../review-comments/:commentId/replies`

Reply to an existing thread. `:commentId` is the numeric `databaseId`. Body `{ body: string }`.

```ts
200 → { ok: true }
400 → { error: 'empty_body' }
502 → { error: 'github_unavailable' }
```

### `POST .../threads/:threadId/resolve`

Resolve / unresolve a thread (GraphQL, by thread node id). Body `{ resolved: boolean }`.

```ts
200 → { resolved: boolean }
502 → { error: 'github_unavailable' }
```

### `POST /api/repos/:owner/:repo/actions/:runId/rerun`

Rerun a workflow run's failed jobs. **Repo-scoped** — `:runId` is the Actions run id (from a check's
`runId`), not a PR number. No mirror to update.

```ts
200 → { ok: true }
401 → { error: 'unauthenticated' } | { error: 'reauth' }
403 → { error: 'forbidden' }
502 → { error: 'github_unavailable' }
```

---

## Actions reads (`/api/repos/:owner/:repo/actions/...`)

`apps/desktop/src/plugins/github/server/routes/actions.ts`. Read-only Actions endpoints for the checks side panel
(**GitHub**; no mirror — the client query cache covers reuse). Writes (rerun) live in `prActions.ts`
above.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/repos/:owner/:repo/actions/runs/:runId/jobs` | A run's jobs + their steps → `{ jobs: WorkflowJob[] }`. |
| `GET` | `/api/repos/:owner/:repo/actions/jobs/:jobId/logs` | One job's full plaintext log → `{ text }` (follows GitHub's signed-blob redirect manually, re-fetching **without** the auth header; a non-redirect 2xx — e.g. logs not ready — returns the raw body as `text`). |

`401 unauthenticated|reauth`, `502 github_unavailable`.

---

## Create PR (`/api/repos/:owner/:repo/...`)

`apps/desktop/src/plugins/github/server/routes/prCreate.ts`. Create-a-PR support. Branch/compare reads are
**GitHub** proxies (no mirror — they change too often); the create busts the open-pulls sync state so
the list refetches.

| Method | Path | Purpose | Body / params |
| --- | --- | --- | --- |
| `GET` | `/api/repos/:owner/:repo/branches` | Branch names for head/base pickers, newest-first (100 most-recent). GraphQL: pages through branch refs (up to 30 pages / 3000 branches), sorts by tip `committedDate` server-side. | → `{ name }[]` |
| `GET` | `/api/repos/:owner/:repo/compare` | `base..head` → diff preview + commits + `aheadBy`. | `?base=&head=` → `Compare` |
| `POST` | `/api/repos/:owner/:repo/pulls` | Create the PR. | `{ title, body?, base, head, draft? }` → `{ number }` |

Errors: `400 bad_request` (missing title/base/head), `401 reauth`, `422 <github message>` (PR exists /
no commits / bad branch — GitHub's message is surfaced verbatim), `502 github_unavailable`.

---

## Mentions (`/api/repos/:owner/:repo/mentions`)

`apps/desktop/src/plugins/github/server/routes/mentions.ts`. Participant logins for `@`-autocomplete — **Mirror**-only
(distinct authors across mirrored PRs / reviews / comments / threads; unknown repo → `[]`).

```ts
200 → string[]   // sorted, deduped
```

---

## Error codes {#error-codes}

Every error body is the `ApiError` envelope `{ error, detail? }` (see [Conventions](#conventions));
the `error` values below are the stable machine codes, and `detail` (when present) carries prose.

| Code | Error | Meaning |
| --- | --- | --- |
| `400` | `bad_number`, `bad_request`, `bad_numbers`, `bad_files_mode`, `bad_paths`, `too_many_paths`, `empty_body`, `empty_name`, `empty_login`, `body_required` | Malformed request |
| `400` | `provider_bad_config`, `provider_secret_unreadable`, `cannot_delete_default` | Provider configuration / workspace guardrails |
| `401` | `unauthenticated` | No / invalid session cookie (and no valid internal token) |
| `401` | `reauth` | GitHub returned `401` — token revoked/expired; client bounces to `/auth/login` |
| `401`/`403` | `provider_not_connected`, `provider_needs_auth`, `provider_missing_scope` | Provider connection/capability state |
| `403` | `forbidden` | GitHub `403` (insufficient scope/permission, e.g. rerun-failed-jobs) |
| `403` | `sso` | GitHub `403` requiring SAML SSO authorization (`x-github-sso` header) |
| `403` | (auth) `invalid state` | OAuth state mismatch/consumed (`/auth/callback`) |
| `404` | `repo_not_found`, `pull_not_found`, `not_found`, `provider_resource_not_found`, `provider_resource_deleted` | Resource not in the local mirror / not on the provider |
| `409` | `merge_failed` | Not mergeable (GitHub 405) or head moved (409) |
| `409` | `node_id_unknown`, `head_sha_unknown` | Mirror lacks node id / head sha — open the PR first |
| `422` | `auto_merge_not_allowed`, `validation_failed` | GraphQL/REST validation refusal (auto-merge, create PR). Create-PR puts GitHub's verbatim 422 prose in `detail` |
| `429` | `rate_limited` | GitHub primary/secondary rate limit |
| `502` | `github_unavailable` | Any other non-OK GitHub response (incl. GraphQL mutation errors) |
| `502` | `graphql` (`detail: string[]`) | Composite/batch GraphQL query returned errors |
| `403`/`429`/`502` | `provider_resource_forbidden`, `provider_rate_limited`, `provider_unavailable` | Provider resource or upstream failure |
| `500` | `failed` (message in `detail`) | Harness route whose bridge call threw an unclassified error |
| `500` | `internal` (message in `detail`) | Any route that threw an uncaught error — the app-level `onError` backstop |
| `503` | `bridge-unavailable` | Harness `/api/tasks/:id/{notes,memory,run,browser}` with no main-process bridge (e.g. `dev:node`) |

> The `401`/`429`/`403`(`forbidden`/`sso`) rows are produced by the shared `ghError()` helper in
> `apps/desktop/src/plugins/github/server/index.ts`, applied uniformly across every GitHub-backed route.
> Endpoint-specific statuses (merge `405`/`409`, GraphQL `errors`, create-PR `422`) are handled by the
> route before it delegates the rest to `ghError()`. Any GitHub-backed route may additionally return
> `rate_limited` / `sso` / `forbidden` per this table.

---

## Source

- Route mount map: `apps/desktop/src/core/server/index.ts`
- Middleware: `apps/desktop/src/core/server/middleware/auth.ts`
- Routes: `apps/desktop/src/server/routes/*`
- Shared contract: `apps/desktop/src/core/shared/api.ts` (+ `api.test.ts`)

**See also:** [authentication](./authentication.md) · [data-layer](./data-layer.md) ·
[caching](./caching.md) · [github-integration](./github-integration.md) ·
[integrations](./integrations.md) · [mcp](./mcp.md) ·
[notes-and-memory](./notes-and-memory.md) · [architecture-overview](./architecture-overview.md)

---
