# API Reference

A node's complete HTTP surface: one namespace, `/v2`. One Hono app
(`packages/node-core/src/server/index.ts`, a `createApp()` factory) mounts `/v2/core/*` for the core
routers it names directly and `/v2/p/<plugin>/*` for every plugin-owned router, which arrives through
the route registry (`server/routeRegistry.ts`) rather than a core import. There is no `/api` mount, no
`/auth` mount, no static assets and no SPA fallback — a node serves no web assets, so an unmatched
path gets Hono's plain 404. See [architecture-overview](./architecture-overview.md) and
[electron](./electron.md).

A few routers still state their own top-level segment internally, so it repeats under their namespace:
`/v2/p/terminal/terminal/sessions`, `/v2/p/memory/memory`,
`/v2/p/workflows/workflows/runs/:runId/steps`. That doubling is deliberate and the paths below are
literal — rewriting those internal paths is later route-declaration work, not part of the reshape that
introduced the namespaces.

> **The transport changed in vNext Phase 1**: namespace, listener and credential all moved together.
> Where the shipped code deliberately stops short of the design docs in `docs/vNext/`, the reasons are
> catalogued in [vNext/phase1-notes.md](./vNext/phase1-notes.md).

**Listener.** `packages/node-core/src/main/server.ts` starts an **HTTPS** server
(`minVersion: 'TLSv1.3'`, self-signed cert minted into the data root) bound to `127.0.0.1` on an
**ephemeral** port. `ACORN_PORT` forces a specific one and never falls back; otherwise the port this
data root last bound is remembered in `node.json` and preferred, with an ephemeral port as the
fallback when something else has taken it. There is no pinned origin — the node reports where it
bound. The service itself runs as an ordinary Node **child process** spawned by Electron main
(`apps/desktop/src/app/main/serviceHost.ts`).

**Who calls it.** The renderer loads from its own origin, `app://acorn`
(`apps/desktop/src/app/main/appScheme.ts`), and never shares an origin with a node. Its only HTTP path
is `window.acorn.nodeFetch` / `nodeSend` over preload IPC into Electron main's connection broker
(`apps/desktop/src/app/main/nodeBroker.ts`), which owns the endpoint, the pinned certificate and the
device bearer — the renderer holds no credential and, under its CSP (`connect-src 'self'`), cannot
reach a node directly at all. `packages/client-core/src/apiClient.ts` keeps one raw same-origin
`fetch` branch for when no broker is present (`dev:node`, unit tests); that path carries no device
token by definition.

> **History:** acorn began as a Cloudflare Worker. Some inline code comments still say "the Worker" /
> "D1 / KV" — read those as "the local server" / "local SQLite" / "the on-disk blob dir".

> **Transport:** request/response uses HTTP routes and live streams use one
> WebSocket. Route families include `/v2/p/editor/tasks/:id/{search,editor/*}`,
> `/v2/p/changes/tasks/:id/local/*`, `/v2/p/database/tasks/:id/database/*`,
> `/v2/p/terminal/terminal/*` + `/v2/p/terminal/tasks/:id/{archive,preview-url,on-created,
> use-checkout,mcp}`, `/v2/p/workflows/tasks/:id/workflows` +
> `/v2/p/workflows/workflows/runs/:runId/*`, `/v2/p/memory/memory*` +
> `/v2/p/memory/workspaces/:wsId/notes*`, `/v2/p/memory/tasks/:id/notes*`, and the `RunBridge` at
> `/v2/core/tasks/:id/run/*`. Each is backed by a service-process **bridge** (`server/bridge.ts`;
> 503 `bridge-unavailable` when unwired).
> Live streams (PTY output/input, session status, workflow notices) ride one authenticated
> WebSocket at `/v2/events` (`packages/protocol/src/ws.ts`), opened and owned by main's broker rather
> than the renderer — see [electron.md §12](./electron.md) for the transport + `dev:node`
> capability map.

## Middleware & auth

Every `/v2/*` route runs through four middlewares before the handler, in this exact order
(`packages/node-core/src/server/index.ts`):

1. `requestIdMiddleware` (`packages/node-core/src/server/respond.ts`) — mounted on `*`, before
   anything else, so every response (public or authenticated, success or failure) carries an
   `X-Request-Id` and a user-reported failure is findable in the node's log. A caller-supplied id is
   echoed only when it matches the bounded grammar; otherwise one is minted.
2. `authMiddleware` (`packages/node-core/src/server/middleware/auth.ts`) — resolves a **`Principal`**
   (`{ kind: 'device' | 'internal'; userId; deviceId? }`) from **either** of two credentials, and
   never enforces:
   - a paired client's **device bearer** (`Authorization: Bearer …`, authenticated against the node's
     device store) → `kind: 'device'`. Every paired device is the owner and carries full owner
     authority. A presented bearer that fails is a rejection, not an invitation to try the next
     mechanism — it does *not* fall through to the internal token.
   - the internal-loopback header **`x-acorn-internal: <INTERNAL_TOKEN>`** → `kind: 'internal'`.
     This is a child process the node spawned (the acorn MCP server, command-variable executions) —
     it holds no device token. `INTERNAL_TOKEN` is private persisted bearer material
     (`packages/node-core/src/main/bindings.ts`), injected into task terminal sessions as
     `ACORN_API_TOKEN`. It resolves its identity through the explicit active-identity binding rather
     than selecting a cached row, and fails closed with no binding.
3. `requireUser` (`packages/node-core/src/server/middleware/requireUser.ts`) — the single auth gate
   over `/v2/*`. It rejects any request with no resolved principal → `401 unauthenticated`. Routes
   carry no inline session guards; handlers read the owner via `ownerId(c)`, which returns the
   owner's login and nothing else (safe because the gate guarantees a principal). Gating on the
   principal rather than on a specific credential keeps a future caller a new `kind` rather than a
   per-route change. See [security.md](./security.md).
4. `idempotency` (`packages/node-core/src/server/middleware/idempotency.ts`) — below the gate on
   purpose: replay is keyed on the caller's `deviceId`, which only exists once the principal is
   resolved and enforced. An `Idempotency-Key` (any UUID) is honoured when present and never
   demanded; a duplicate arriving while the first is still executing waits for it and gets its
   response, a key reused with a different request is `409 idempotency_conflict`, and 5xx outcomes are
   not stored so a genuine retry re-executes. The internal principal has no device row, so no key
   space — it passes through untouched.

Exactly two routes sit above the gate, and they are pre-auth by construction because a client that has
never paired holds no credential: `GET /v2/node` and `POST /v2/pair` (see
[Pairing and devices](#pairing-and-devices)). They still run under `authMiddleware` — public, not
unprotected — and everything that *administers* devices stays under `/v2/core`, below the gate.

**There is no `csrf()`, and its absence is deliberate rather than an omission.** CSRF exists to defend
*ambient* credentials, and this app has none left: every request carries a bearer that lives in
Electron main's connection broker, nothing a cross-site page can do makes anything attach it, and the
renderer cannot open a socket to a node at all. The check used to be mounted on `/auth` only, for the
one cookie-backed mutation; that route and its cookie are gone. Reinstating it over `/v2` would
additionally break correct callers, because `hono/csrf` treats a *missing* content-type as
form-submittable and 403s any bodyless mutation — `DELETE /v2/core/devices/:id`, for one.

## Conventions

- All responses are JSON unless noted. Timestamps are epoch **milliseconds**.
- **Error envelope:** every error body is the nested `ApiError`
  (`packages/protocol/src/errors.ts`, re-exported from `api.ts`), built by one server helper,
  `respondError(c, status, code, detail?, details?)`
  (`packages/node-core/src/server/respond.ts`):

  ```json
  { "error": { "code": "not_found", "message": "No such device.", "requestId": "…", "retryable": false } }
  ```

  `code` is a stable machine code the client branches on (see [Error codes](#error-codes));
  `message` is human/upstream prose for people (GraphQL messages, GitHub's 422 text, harness failure
  messages) — `respondError`'s `detail: string[]` is joined into it, and falls back to the code when a
  route supplies none. `requestId` matches the `X-Request-Id` response header. `retryable` is derived
  from the status (408/429/502/503/504) so no route maintains a table. `details` is optional and
  carries structured extra data. There is no second error shape: the app-level `onError` backstop
  turns an uncaught throw into `500 internal` in the same envelope, and error bodies never carry
  secrets, tokens, file contents or provider response bodies.
- **Error notation:** in the response sketches below, an error line names only the envelope's `code`
  (`404 → 'repo_not_found'`). The body is always the full nested shape above.
- Success **response mappers** are checked against the shared response types with `satisfies`
  (`packages/protocol/src/api.ts`), so adding a required field to a response type fails
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
  - **Bridge** — proxied to a service-process per-domain bridge (returns `503` when that runtime
    capability is unavailable, notably in `dev:node`).
  - **Provider** — a live third-party (Linear/Rollbar) call, cached locally.

## Shared client contract

The client uses a small shared TypeScript contract rather than a runtime RPC client.
`packages/protocol/src/api.ts` owns response types, route builders, and query-key factories;
`packages/client-core/src/queries.ts` and `mutations.ts` consume those helpers through the thin
`apiClient.ts` helpers (`readJson` / `writeJson` / `postJson` / `sendForm`), which hand the path to the
broker. Route builders produce paths, never absolute URLs — the origin belongs to the broker, and a
path can no longer be handed to the browser as an `href` or `src` because under `app://` it would
resolve against the protocol handler rather than a node (so downloads come back as bytes via
`readBytes`). That keeps the client bundle thin and preserves the exact request shape of the HTTP API:
no generated client, no extra network calls, no runtime wrapper on the hot read paths.
`packages/protocol/src/api.test.ts` characterizes the route strings and query-key shapes so cache
compatibility does not drift.

---

## Pairing and devices {#pairing-and-devices}

`packages/node-core/src/server/routes/pairing.ts`. Two routers on opposite sides of the auth gate: the
pre-auth pair is how a client that holds no credential gets one, and the `/v2/core` set is device
administration below the gate. Devices are **App-state**; the pairing window is per-node in-memory
state, which is why the router is a factory rather than a module-level singleton.

| Method | Path | Purpose | Gate |
| --- | --- | --- | --- |
| `GET` | `/v2/node` | Node identity: `protocolVersion` and the certificate `fingerprint` the client pins against, widened with `nodeId` + `appVersion` for an authenticated caller. | pre-auth |
| `POST` | `/v2/pair` | Consume a live pairing code → `{ deviceToken, nodeId, device }`. The one time the raw token exists outside the client; never logged. | pre-auth |
| `POST` | `/v2/core/pair/start` | Open a pairing window and return `{ code, expiresInMs }` for the node's own UI to show as QR + text. Issuing again replaces any live code. | behind `requireUser` |
| `DELETE` | `/v2/core/pair` | Close the pairing window → `204`. Idempotent: closing a closed window is not a `404`. | behind `requireUser` |
| `GET` | `/v2/core/devices` | List paired devices → `{ devices }`. | behind `requireUser` |
| `DELETE` | `/v2/core/devices/:id` | Revoke a device → `204`; `404 not_found` only when it never existed. A device may revoke itself ("unpair this machine"). | behind `requireUser` |

Every pairing failure is byte-identical — `401 pairing_failed` with the same message and no details —
so a malformed body, no open window, an expired window, an exhausted attempt budget and a wrong code
are indistinguishable and nothing here is an oracle. On top of the per-window attempt budget, `POST
/v2/pair` carries a per-node churn ceiling that answers `429 rate_limited`. Advertising the
fingerprint over the connection being authenticated proves nothing by itself; it is the value the owner
compares against the code the node displays. See [vNext/security.md](./vNext/security.md).

---

## Pins (`/v2/p/github/pins`)

`plugins/github/src/server/routes/pins.ts`. Pinned repos for the selector — **App-state**, user-scoped.
Moved out of core with the `pinned_repos` table in Phase 2: a pinned repo is github-shaped data, so it
lives in the github plugin's own database (docs/vNext/data.md § Plugin DBs).

### `GET /v2/p/github/pins`

This user's pinned repo ids, in pin order (the `sort` column, ascending — a new pin appends at
`max(sort) + 1`).

```ts
200 → number[]
401 → 'unauthenticated'
```

### `PUT /v2/p/github/pins`

Pin or unpin one repo. Body `{ repoId: number, pinned: boolean }`.

```ts
200 → { repoId, pinned }
400 → 'bad_request'
```

---

## Prefs (`/v2/core/prefs`)

`packages/node-core/src/server/routes/prefs.ts`. App-state preferences (theme, diff view mode, …) —
user-scoped key→value store.

### `GET /v2/core/prefs`

```ts
200 → Record<string, string>
```

### `PUT /v2/core/prefs`

Upsert one preference. Body `{ key: string, value: string }`.

```ts
200 → { key, value }
400 → 'bad_request'
```

---

## Agent usage and pricing (`/v2/p/agents`)

`plugins/agents/src/server/routes/usage.ts`. Plugin-owned, user-scoped provider usage
and the local Claude estimate catalog. Usage collection is a **Bridge**; pricing overrides are
**App-state** stored in the generic prefs table under an agents-owned key.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v2/p/agents/usage` | Read the five-minute cached Claude/Codex usage snapshot. The current user's pricing preferences are part of the cache identity. |
| `POST` | `/v2/p/agents/usage/refresh` | Force both provider collectors to run and recalculate the Claude estimate. |
| `GET` | `/v2/p/agents/pricing` | Read the user's versioned Claude catalog overrides and exact-model prices. |
| `PUT` | `/v2/p/agents/pricing` | Validate and replace that pricing preference. Invalid model ids, duplicate rows, unknown built-in ids, and non-finite/negative prices return `400 bad_request`. |

Pricing values are USD per million tokens for input, output, cache write, and cache read. They affect
Acorn's estimate only. The shared contract and default catalog live in
`plugins/agents/shared/pricing.ts`; core has no model-pricing contract.

### Managed sessions (`/v2/p/agents`)

`plugins/agents/src/server/routes/managed.ts`. These routes bridge
to the service-process managed runtime. Provider processes, session state and object bytes never
move into the Hono process boundary as raw handles.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v2/p/agents/providers` | Discover provider installation/auth health and advertised capabilities/configuration. |
| `GET` | `/v2/p/agents/sessions` | Paginated task/attention/archive-filtered session list. |
| `GET` | `/v2/p/agents/sessions/search` | FTS over titles, messages, tool summaries and artifact metadata. |
| `POST` | `/v2/p/agents/sessions` | Idempotently create a task-scoped session. |
| `POST` | `/v2/p/agents/transcript-imports` | Import Acorn/Claude/Codex history as read-only local history. |
| `GET` | `/v2/p/agents/sessions/:id` | Session projection, turns, requests and paginated normalized events. |
| `GET` | `/v2/p/agents/sessions/:id/events` | Continue event replay after a durable sequence. |
| `PATCH` | `/v2/p/agents/sessions/:id` | Rename, archive/unarchive or advance the exact read sequence. |
| `DELETE` | `/v2/p/agents/sessions/:id` | Permanently delete local history/references and report provider-side delete support. |
| `POST` | `/v2/p/agents/sessions/:id/turns` | Idempotently enqueue a turn; dispatch waits for protocol readiness. |
| `PATCH/DELETE` | `/v2/p/agents/sessions/:id/turns/:turnId` | Edit/reorder or remove an undispatched queued turn. |
| `POST` | `/v2/p/agents/sessions/:id/cancel` | Cancel the active or named queued turn. |
| `POST` | `/v2/p/agents/sessions/:id/requests/:requestId/resolve` | Idempotently resolve one provider/workflow request. |
| `POST` | `/v2/p/agents/sessions/:id/{fork,compact}` | Capability-gated native operation, with an explicitly labelled context-copy fallback for fork. |
| `POST` | `/v2/p/agents/sessions/:id/handoff-terminal` | Transfer the exclusive input-controller lease to a raw provider TUI. |
| `POST` | `/v2/p/agents/sessions/:id/resume-managed` | Return a clean stopped terminal-owned provider reference to Acorn. |
| `POST` | `/v2/p/agents/sessions/:id/verify-imported-resume` | Live-verify an imported provider reference before enabling input. |
| `GET` | `/v2/p/agents/sessions/:id/export` | Markdown or lossless versioned JSON export. |
| `GET` | `/v2/p/agents/sessions/:id/wait` | Cursor wait for ready, attention, turn completion or stop. |
| `POST/GET/DELETE` | `/v2/p/agents/attachments[/:id]` | Stream validated task-scoped uploads and manage unreferenced metadata. |
| `GET` | `/v2/p/agents/sessions/:id/artifacts` | List large session artifacts. |
| `GET` | `/v2/p/agents/artifacts/:id/content` | Authenticated, no-store artifact download. |

Session create, turn enqueue and request resolution require an `Idempotency-Key` header. All input
paths and context references are revalidated against the owning task worktree. See
[managed-agents.md](./managed-agents.md).

---

## Workspaces (`/v2/core/workspaces`)

`packages/node-core/src/server/routes/workspaces.ts`. A **Workspace** is a named group of repos — the
top-level unit. All routes are **App-state** (machine-scoped tables `workspaces`, `workspace_repos`,
`ignored_repos`, `workspace_projects`); `bootstrap` and `ignore-all` also read the repos **Mirror**.
See [workspaces-and-tasks](./workspaces-and-tasks.md).

| Method | Path | Purpose | Body / params |
| --- | --- | --- | --- |
| `GET` | `/v2/core/workspaces` | List workspaces with their (non-ignored) repos, ordered by `sort`. | — |
| `POST` | `/v2/core/workspaces/bootstrap` | Idempotent first-run: create `Default`, assign every mirrored repo not yet in a workspace. Returns the full list. | — |
| `POST` | `/v2/core/workspaces` | Create a workspace. | `{ name }` → `Workspace` |
| `PATCH` | `/v2/core/workspaces/:id` | Update workspace identity: name / icon / color. `null` clears icon/color to the derived default. `404` on unknown ids. (Build/run/db/preview config is repo-level — see `PUT /v2/p/terminal/terminal/repo-path/config`.) | `{ name?, icon?, color? }` |
| `DELETE` | `/v2/core/workspaces/:id` | Delete; its repos are reassigned to `Default`, its project links dropped. `Default` cannot be deleted. | — |
| `POST` | `/v2/core/workspaces/:id/repos` | Move a repo into this workspace (partition upsert on `(owner,name)`); clears any ignore flag. | `{ owner, name, sort? }` |
| `GET` | `/v2/core/workspaces/assignments` | Per-repo assignment map for onboarding: `{ owner, name, workspaceId, ignored }[]`. | — |
| `POST` | `/v2/core/workspaces/ignore-repo` | Hide a repo (keeps membership, flags it ignored). | `{ owner, name }` |
| `POST` | `/v2/core/workspaces/unignore-repo` | Un-hide a repo. | `{ owner, name }` |
| `POST` | `/v2/core/workspaces/ignore-all` | Hide / show every mirrored repo at once (onboarding master toggle). | `{ ignored: boolean }` |
| `GET` | `/v2/core/workspaces/:id/projects` | This workspace's linked external projects. | → `{ projects: { integrationId, externalId }[] }` |
| `PUT` | `/v2/core/workspaces/:id/projects` | Replace the whole linked-project set. | `{ projects: { integrationId, externalId }[] }` |

Common errors: `401 unauthenticated`; `400 bad_request` (blank name, bad trigger/preview/icon/color,
or a `PATCH` body with no recognized field); `404 not_found` and `400 cannot_delete_default` on
`DELETE`. Validated writes return `{ ok: true }`. Note `PATCH /:id` is a blind update — an unknown
id still returns `{ ok: true }` (no `404`).

---

## Tasks (`/v2/core/tasks`)

A **Task** is the single-repo unit of work. `/v2/core/tasks` is served by five core routers (CRUD,
config trust, context, run, agent tools); the task-scoped surfaces owned by plugins sit under their own
namespaces, as the two `plugins/` subsections below show.

### CRUD — `packages/node-core/src/server/routes/tasks.ts`

All **App-state** (machine-scoped `tasks` / `task_links`). Worktree teardown on archive is the main
process's job; these routes only flip DB rows.

| Method | Path | Purpose | Body / params |
| --- | --- | --- | --- |
| `GET` | `/v2/core/tasks` | List `active` tasks (with links), ordered by `sort`. | → `Task[]` |
| `POST` | `/v2/core/tasks` | Create a task (title auto-seeded if absent: `#<pull> <repo>` or `<repo> · <branch>`; birth links accepted via `links`). | `TaskSeed` → `Task` |
| `PATCH` | `/v2/core/tasks/:id` | Rename, set `icon` (Lucide name, `null` clears to the origin default), and/or set `status` (`active`\|`archived`; stamps `archivedAt`). `404` on unknown ids. | `{ title?, icon?, status? }` |
| `POST` | `/v2/core/tasks/:id/links` | Add an external link (idempotent; `404` if task missing). | `TaskLink` |
| `DELETE` | `/v2/core/tasks/:id/links` | Remove a link by `(integrationId, identifier)`. | `{ integrationId, identifier }` |

`POST /` requires `origin`, `repoOwner`, `repoName`, `branch`; it and `POST /:id/links` return
`400 bad_request` on missing required fields. `icon` is optional on create and patch: it is
shape-checked against `ICON_NAME_RE` (`/^[a-z0-9-]{1,40}$/`) rather than the icon set, because the
name→node map is client-side — an unrecognised name falls back to rendering as-is, so a bad value is
cosmetic rather than an error. See [ui-design.md](./ui-design.md) §Icons.

### Review notes — `plugins/changes/src/server/routes/reviewNotes.ts`

Local inline annotations on uncommitted changes, acorn-owned (**App-state**, `review_notes`). The
send loop: create (unsent) → deliver → `POST /sent` stamps `sentAt` → an edit clears it.

| Method | Path | Purpose | Body / params |
| --- | --- | --- | --- |
| `GET` | `/v2/p/changes/tasks/:id/review-notes` | List a task's notes, oldest first. | → `ReviewNote[]` |
| `POST` | `/v2/p/changes/tasks/:id/review-notes` | Create a note (`404` if task missing). | `ReviewNoteSeed` → `ReviewNote` |
| `PATCH` | `/v2/p/changes/tasks/:id/review-notes/:noteId` | Edit body; clears `sentAt`. | `{ body }` |
| `DELETE` | `/v2/p/changes/tasks/:id/review-notes/:noteId` | Delete a note. | — |
| `POST` | `/v2/p/changes/tasks/:id/review-notes/sent` | Stamp `sentAt` on the given note ids (delivery confirmation). | `{ ids: string[] }` |

`400 bad_request` on invalid path/side/lines/body or empty id list. `side` is
`'additions' | 'deletions'` (diff-pane sides, not GitHub's `LEFT`/`RIGHT`); `endLine` defaults to
`startLine`.

### Task context — `packages/node-core/src/server/routes/taskContext.ts`

The context assembler — never a live GitHub call, so the agent sees the same picture as the UI.
The contribution registry assembles PR/issues from the **Mirror** and notes/memory from service-process
stores. The response carries serialized section metadata/items/compact text; `include=*` returns the
inventory for the Context pane, while an omitted include uses contribution defaults.

| Method | Path | Purpose | Params |
| --- | --- | --- | --- |
| `GET` | `/v2/core/tasks/:id/repo-info` | Repo facts for the MCP `repo_info` tool: `{ owner, name, defaultBranch, branch, worktreePath }`. | — |
| `GET` | `/v2/core/tasks/:id/context` | Assembled `TaskContext` and projected sections. | `?include=<section ids>`; internal workflow assembly also passes `workflowRunId` to exclude other runs' handoffs |

`404 not_found` when the task id is unknown.

### Agent-tool projection — `packages/node-core/src/server/routes/agentTools.ts`

The registry is installed by the service composition root. This is where the two principal kinds
diverge: the MCP/harness paths require `kind: 'internal'` and the renderer projection requires
`kind: 'device'`, each answering `404 not_found` to the other. Missing registries return
`503 bridge-unavailable`; hidden, unavailable, or wrong-principal tools are indistinguishable
`404 not_found` responses.

| Method | Path | Purpose | Body / params |
| --- | --- | --- | --- |
| `GET` | `/v2/core/tasks/:id/tools` | Available MCP manifest with draft-07 input schemas. | internal token |
| `POST` | `/v2/core/tasks/:id/tools/:name` | Validate and invoke an agent tool. | contribution-owned JSON; internal token |
| `POST` | `/v2/core/tasks/:id/renderer-tools/:name` | Invoke an `exposeToRenderer` contribution. | contribution-owned JSON; device bearer |
| `GET` | `/v2/core/agent-tools` | Static name/description/risk/availability catalog for Settings. | — |
| `GET/POST` | `/v2/p/memory/tasks/:id/notes[/:slug]` | Task-scoped renderer note CRUD; PUT/DELETE and `/included` also apply. | note body/title/included shape |
| `GET/POST` | `/v2/p/memory/workspaces/:wsId/notes[/:slug]` | Workspace note CRUD; reserved `wsId=global` addresses global notes. | note body/title/included shape |
| `GET` | `/v2/core/tasks/:id/run` | List run targets for the task. | — |
| `POST` | `/v2/core/tasks/:id/run/:target/start` | Start a run target. | — |
| `POST` | `/v2/core/tasks/:id/run/:target/stop` | Stop a run target. | — |
| `POST` | `/v2/core/tasks/:id/run/:target/restart` | Restart a run target. | — |
| `GET` | `/v2/core/tasks/:id/run/:target/status` | Run-target status. | — |

The remaining `/run/*` rows are renderer routes backed by `RunBridge`; agent-facing run/browser,
notes, memory, context, and git verbs go through `/tools/:name`.

### Workflow control — `plugins/workflows/src/server/routes/workflow.ts`

The service process installs the durable runner behind this bridge. Definitions and controls
use HTTP; live notices, status pings, and step events use the authenticated WebSocket.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v2/p/workflows/tasks/:id/workflows` | Load validated repo/user workflow definitions plus named parse errors. |
| `POST` | `/v2/p/workflows/tasks/:id/workflows` | Validate and start `{ def }`; returns `{ runId }` or a named validation error. |
| `GET` | `/v2/p/workflows/tasks/:id/workflows/runs` | List durable runs for a task. |
| `GET` | `/v2/p/workflows/workflows/runs/:runId/steps` | List top-level/fan-out step rows with a profile-projected resume command when available. |
| `POST` | `/v2/p/workflows/workflows/runs/:runId/gate` | Resolve a waiting human gate with `{ stepId, approved }`. |
| `POST` | `/v2/p/workflows/workflows/runs/:runId/cancel` | Cancel the run tree and abort active handlers. |
| `POST` | `/v2/p/workflows/workflows/runs/:runId/kill` | Kill one running step with `{ stepId }`. |
| `POST` | `/v2/p/workflows/workflows/triggers/poll` | Evaluate registered trigger predicates on the app-open client poll tick. |

---

## Task config trust (`/v2/core/tasks/:id/config-trust`)

Repo-authored executable config is hash-gated before a run target, workflow, setup, or other
executable contribution can use it.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v2/core/tasks/:id/config-trust` | Return the current snapshot/hash, trusted state, and diff from the latest acknowledged snapshot. |
| `POST` | `/v2/core/tasks/:id/config-trust` | Acknowledge the exact `{ hash }`; a changed hash must be reviewed again. |

Execution surfaces return `409 needs-trust` (or `config-changed`) rather than running an
unacknowledged snapshot.

## Worktree-local task surfaces

Four plugins own task-scoped worktree surfaces. Each is task-addressed under its own plugin namespace
(`/v2/p/<plugin>/tasks/:id/…`) rather than sharing one flat table, which is what lets a node enable or
disable a plugin's whole route surface at once. They sit behind the same `/v2` auth gate as everything
else and return `503 bridge-unavailable` when their runtime capability is absent.

| Family | Base | Routes | Purpose |
| --- | --- | --- | --- |
| Editor | `/v2/p/editor/tasks/:id/` | `GET editor/root`, `editor/files`, `editor/list?path=…`, `editor/read?path=…`; `PUT editor/file` | Resolve the root, browse/read, and save worktree files with path containment. |
| Search | `/v2/p/editor/tasks/:id/` | `POST search` | Ripgrep search with query/case/word/regex options and bounded results. |
| Local git | `/v2/p/changes/tasks/:id/` | `GET local/changes`, `local/diff`, `local/blob`; `POST local/stage`, `unstage`, `discard`, `commit`, `stage-all`, `unstage-all`, `discard-all`, `push` | Review and mutate the task working tree. Destructive operations are renderer-confirmed. |
| Database | `/v2/p/database/tasks/:id/` | `POST database/connect`, `disconnect`, `query`, `update`, `insert`, `delete`, `generate`; `GET database/tables`, `columns`, `rows`, `queries`; `POST database/queries`; `DELETE database/queries/:queryId` | Task Postgres connection, browsing/editing, repo-saved SQL, and provider-assisted generation. |

Database connections/pools live in main and are disposed on task/app teardown. Saved queries are
repo-scoped, not task-scoped. See [pg.md](./pg.md).

## Terminal, task lifecycle, and MCP setup (`/v2/p/terminal`)

| Method and path | Purpose |
| --- | --- |
| `GET /v2/p/terminal/terminal/sessions` · `/profiles` · `/task-statuses` | Current session/profile/worktree status inventory |
| `POST /v2/p/terminal/terminal/sessions` | Create a shell/agent/run-target session |
| `POST /v2/p/terminal/terminal/sessions/:sid/{kill|interrupt|remove|resize|send}` | Control a live session |
| `GET/PUT /v2/p/terminal/terminal/repo-path` | Read/map a checkout |
| `PUT /v2/p/terminal/terminal/repo-path/run-targets` | Replace DB-fallback run targets |
| `PUT /v2/p/terminal/terminal/repo-path/config` | Update lifecycle/db/preview/browser/branch settings |
| `POST /v2/p/terminal/tasks/:id/preview-url` | Resolve a task preview URL |
| `POST /v2/p/terminal/tasks/:id/on-created` | Apply configured creation lifecycle |
| `POST /v2/p/terminal/tasks/:id/use-checkout` | Adopt the mapped checkout/current branch |
| `POST /v2/p/terminal/tasks/:id/archive` | Guarded session/dirty/config teardown and archive |
| `GET /v2/p/terminal/tasks/:id/mcp` | Inspect effective MCP configuration |
| `POST /v2/p/terminal/tasks/:id/mcp/starter` | Create a starter repo MCP config |

Terminal output itself uses the authenticated WebSocket and is never stored in these responses.

## Docker (`/v2/p/docker`)

| Method and path | Purpose |
| --- | --- |
| `GET /info`, `/containers`, `/images`, `/volumes`, `/networks` | Daemon/resource inventories |
| `GET /containers/:ref/inspect` | Container detail |
| `POST /containers/:ref/action`, `/containers/:ref/remove` | Container lifecycle/removal |
| `POST /images/:ref/remove`, `/volumes/:ref/remove`, `/networks/:ref/remove` | Resource removal |
| `POST /prune`, `/compose/action` | Prune or Compose lifecycle |
| `GET /task-summary`, `/tasks/:id/containers` | Task/container matching projections |
| `POST /tasks/:id/teardown` | Compose-down/stop matched containers |

Refs are argv-shape validated. Live events, logs, stats, and exec travel over the authenticated
WebSocket. See [docker.md](./docker.md).

## HTTP client (`/v2/p/http/:owner/:repo`)

| Method and path suffix | Purpose |
| --- | --- |
| `GET/POST /requests` | List/create repo or task-ad-hoc requests |
| `PUT/DELETE /requests/:id` | Update/file/move/delete a request |
| `GET/POST /vars` | List/create encrypted repo variables |
| `PUT/DELETE /vars/:id` | Update/delete a variable |
| `POST /send` | Resolve referenced variables and execute a draft |

This whole family additionally requires `principal.kind === 'device'` — the owner at a client is the
only principal allowed to drive the pane, so an internal (agent/MCP child) token receives
`403 interactive_user_required` and can never use it as a secret-decryption oracle. See
[http-client.md](./http-client.md).

---

## Integrations (`/v2/core/integrations`)

`packages/node-core/src/server/routes/integrations.ts`. List/connect/disconnect third-party providers.
Multi-row per provider, and GitHub is now an ordinary **stored** row like any other — it used to be
synthesized here because its token *was* the session cookie and there was no row to list. Connecting
validates the pasted credential **live** against the provider, then stores it encrypted
(`encryptSecret`) — **App-state** otherwise. GitHub itself connects through the device flow below, not
by pasting a token.

| Method | Path | Purpose | Body |
| --- | --- | --- | --- |
| `GET` | `/v2/core/integrations` | Public provider catalog plus stored connection summaries. | → `{ providers, integrations }` |
| `POST` | `/v2/core/integrations` | Descriptor-driven validate/normalize/encrypt/store. | `{ providerId, credentials }` → `{ integration }` |
| `PUT` | `/v2/core/integrations/:id` | Rotate credentials while preserving connection identity and linked state. | `{ credentials }` |
| `POST` | `/v2/core/integrations/:id/test` | Test health and update connection status. | — |
| `PATCH` | `/v2/core/integrations/:id` | Disable/re-enable without deleting linked state. | `{ disabled }` |
| `DELETE` | `/v2/core/integrations/:id` | Disconnect; cascades workspace bindings, cached issues, and task links → `204`. | — |

Stored connection ids are opaque uuids; the literal id `github` (the old synthesized entry) is
rejected with `400 provider_bad_config`, as is a `POST` with no `providerId` or a `PATCH` whose
`disabled` is not a boolean. Other errors use the generic `provider_*` taxonomy listed below. See
[integrations](./integrations.md).

---

## GitHub connect (`/v2/p/github/auth/device`)

`plugins/github/src/server/routes/deviceAuth.ts`. GitHub's OAuth **device authorization grant** — how a
GitHub credential enters a node. The owner supplies nothing by hand: the github provider descriptor
declares `fields: []` and `connection.kind: 'device-flow'`, which is what tells the settings UI to run
this flow instead of rendering a form, and these routes hand the token GitHub issued to the same
`connectProvider` path every other provider uses. So the token lands in an encrypted `integrations` row
and is read from there by every GitHub-backed route
(`plugins/github/src/server/githubToken.ts`); it is never held on the principal and never reaches the
renderer.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v2/p/github/auth/device/start` | Request a device code → `{ deviceCode, userCode, verificationUri, expiresIn, interval }`. `502 provider_unavailable` when GitHub does not issue one. |
| `POST` | `/v2/p/github/auth/device/poll` | Exchange the device code → a `status` of `pending` (optionally `slowDown`), `denied`, `expired`, or `connected` with the stored `integration`. |

Two routes rather than one long poll because the client owns the polling interval: a single request
held open would occupy a slot for as long as the code is valid. Never poll faster than the `interval`
GitHub asks for. Connecting GitHub is also what binds the node's active identity.

---

## Linear (`/v2/p/linear`)

`plugins/linear/src/server/routes/linear.ts`. Reads Linear (**Provider** — live
GraphQL), cached per-user into the generic `issues` table (serve-then-revalidate, 10-min TTL). A bare
identifier is resolved across every connected Linear connection (first-hit-wins); browse routes take
an explicit `?integration=<id>`.

| Method | Path | Purpose | Body / params |
| --- | --- | --- | --- |
| `GET` | `/v2/p/linear/projects` | Projects across every connected Linear, each tagged with its connection. | → `{ projects: LinearProject[] }` |
| `GET` | `/v2/p/linear/project-issues` | Active issues for project ids within one connection. | `?integration=<id>&ids=a,b` |
| `POST` | `/v2/p/linear/issues` | Batch enrichment for referenced tickets → summaries (STR, cached). | `{ identifiers: string[] }` → `{ issues }` |
| `GET` | `/v2/p/linear/issues/:identifier` | Full detail for the side panel. | `?refresh=1`; task-scoped reads also pass `&integration=<connectionId>` |
| `POST` | `/v2/p/linear/issues/:identifier/comments` | Add a comment (or threaded reply via `parentId`). | `?integration=<connectionId>` for task links; `{ body, parentId? }` |

Errors: `provider_not_connected`, `provider_needs_auth`, `provider_resource_not_found`,
`provider_unavailable`, plus `bad_request` for malformed comment bodies.

---

## Rollbar (`/v2/p/rollbar`)

`plugins/rollbar/src/server/routes/rollbar.ts`. The Rollbar Source's reads (**Provider** — live REST),
cached into `issues` (provider `rollbar`, identifier = the visible counter) with serve-then-revalidate
(2-min TTL). List, metadata, occurrence history, and occurrence detail are separate typed contracts with
**independent freshness**: the list gates on `sync_state`, item metadata on the issue envelope's
`detailFetchedAt`, and occurrence resources on `issue_resources`. A failing connection
degrades to its cache. The active list paginates up to `budgets.maxPages` (3 × 100 = 300 items); a
connection returning the full cap is reported in `cappedIntegrationIds`.

`GET /items` returns `{ items: RollbarItemSummary[], failures: [{ integrationId, code }], cappedIntegrationIds: [] }`
— partial success is preserved; a hard error is returned only when **no** connection succeeds. `GET /items/:identifier`
returns a `RollbarItemDetail`: the summary plus the normalized, privacy-allowlisted latest occurrence
(exception/message, stack frames, safe request/runtime/person context — never raw payload). `?refresh=true`
forces a fresh upstream read past the TTL. Item summaries carry an account-independent Rollbar item
permalink as `url`; occurrence summaries/details carry a nullable Rollbar UUID redirect as `url`
(null only when upstream omitted the occurrence UUID).

| Method | Path | Purpose | Params |
| --- | --- | --- | --- |
| `GET` | `/v2/p/rollbar/items` | Active items across selected connected Rollbar projects (partial success + capped metadata), cached. | `?integrations=<comma-separated connection ids>` (optional; omitted means all) |
| `GET` | `/v2/p/rollbar/items/:identifier` | Compatibility composite: item metadata + normalized latest occurrence. | `?integration=<id>` (required), `?refresh=true` (optional) |
| `GET` | `/v2/p/rollbar/items/:identifier/detail` | Canonical item metadata; does not fetch occurrence data. | `?integration=<id>` (required), `?refresh=true` (optional) |
| `GET` | `/v2/p/rollbar/items/:identifier/occurrences` | The 50 most recent occurrence summaries, newest first. | `?integration=<id>` (required), `?refresh=true` (optional) |
| `GET` | `/v2/p/rollbar/items/:identifier/occurrences/:occurrenceId` | One privacy-normalized occurrence diagnostic. | `?integration=<id>` (required), `?refresh=true` (optional) |

Errors: `provider_not_connected`, `provider_needs_auth`, `provider_resource_not_found`,
`provider_unavailable`, plus `bad_request` for a missing `integration` parameter.

---

## Repos (`/v2/p/github/repos`)

`plugins/github/src/server/routes/repos.ts`. This user's repos — **Mirror** (serve-then-revalidate,
~5 min TTL), ordered by `pushedAt` desc.

### `GET /v2/p/github/repos`

```ts
200 → Repo[]
  Repo = { id, owner, name, private, defaultBranch, pushedAt }
401 → 'unauthenticated' | 'reauth'   // reauth = GitHub 401
502 → 'github_unavailable'
```

### `POST /v2/p/github/repos/refresh`

Force the next `GET /v2/p/github/repos` to re-sync (sets `fetchedAt = 0`). **App-state** write.

```ts
204 (no body)
```

---

## Repo labels (`/v2/p/github/repos/:owner/:repo/labels`)

`plugins/github/src/server/routes/repoLabels.ts`.

### `GET /v2/p/github/repos/:owner/:repo/labels`

Repo label choices for the PR label picker (**GitHub** — first 100 labels, sorted by name).

```ts
200 → { name, color }[]
401 → 'unauthenticated' | 'reauth'
404 → 'repo_not_found'
502 → 'github_unavailable'
```

---

## Pull lists (`/v2/p/github/repos/:owner/:repo/pulls`)

`plugins/github/src/server/routes/pulls.ts`.

### `GET /v2/p/github/repos/:owner/:repo/pulls?state=open|closed`

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
401 → 'unauthenticated' | 'reauth'
404 → 'repo_not_found'
502 → 'github_unavailable'
```

A GitHub `304` on the open path is handled internally (re-serves the mirror); the client sees `200`.

---

## Pull detail (`/v2/p/github/repos/:owner/:repo/pulls/:number`)

`plugins/github/src/server/routes/pullDetail.ts`. The composite read (GraphQL; **Mirror**, ~45 s TTL,
**TTL-only** — no ETag). Mirror logic shared with the batch route (`prMirror.ts`).
`?force=true` bypasses even a fresh cache entry, blocks on GitHub, and returns the newly mirrored
composite; the UI's explicit PR refresh uses this path.

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
400 → 'bad_number'
401 → 'unauthenticated' | 'reauth'
404 → 'repo_not_found' | 'pull_not_found'
502 → 'github_unavailable'
       | 'graphql'   // GraphQL returned errors
```

A GraphQL-level error (HTTP 200 with an `errors` array) is surfaced as `502 graphql` rather than
masquerading as a `404`.

---

## Pull files (`/v2/p/github/repos/:owner/:repo/pulls/:number/files`)

`plugins/github/src/server/routes/pullFiles.ts`. **Mirror** (REST-backed, ~45 s TTL). Patch bodies are
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
`?force=true` bypasses the freshness gate and blocks until changed-file metadata and available patch
bodies have been fetched and mirrored.

### `POST .../files/patches`

Batch patch fetch for specific paths. Body `{ paths: string[] }` (max 20).

```ts
200 → PullFile[]   // ordered to match the request; [] for an empty list
400 → 'bad_paths' | 'too_many_paths'
```

---

## Pull blob (`/v2/p/github/repos/:owner/:repo/blobs/:sha`)

`plugins/github/src/server/routes/pullBlob.ts`. Full file body at an immutable blob SHA — used to expand
unchanged context around diff hunks. Served from the on-disk **BLOBS** cache (immutable, cached
forever); a miss hits **GitHub** (`git/blobs`) then caches.

```ts
200 → { text: string }
401 → 'unauthenticated' | 'reauth'
404 → 'repo_not_found'
502 → 'github_unavailable'
```

---

## Pull batch prefetch (`/v2/p/github/repos/:owner/:repo/pulls/batch`)

`plugins/github/src/server/routes/pullsBatch.ts`. Warm the mirror for several open PRs at once so client
navigation is instant. Detail is one multi-alias GraphQL call for stale PRs; files are N parallel REST
calls. Already-fresh PRs cost no GitHub calls — **Mirror** with a live top-up.

### `POST .../pulls/batch`

Body `{ numbers: number[], files?: 'full' | 'summary' | 'none' }` (max 10 numbers; `files` default
`full`).

```ts
200 → PullBatchItem[]
  PullBatchItem = { number, detail: PullDetail, files: PullFile[] }
400 → 'bad_numbers' | 'bad_files_mode'
401 → 'unauthenticated' | 'reauth'
404 → 'repo_not_found'
502 → 'github_unavailable' | 'graphql'
```

---

## PR write actions (`/v2/p/github/repos/:owner/:repo/pulls/:number/...`)

`plugins/github/src/server/routes/prActions.ts`. Each resolves the mirror PR row first (`prContext.ts`:
unknown owner/repo → `404 repo_not_found`, non-integer number → `400 bad_number`, GitHub `401` →
`401 reauth`), calls **GitHub**, then updates or busts the SQLite mirror so a within-TTL read reflects
the change. See [github-integration](./github-integration.md#write-actions).

### `POST .../merge`

Body `{ method?: 'merge' | 'squash' | 'rebase' }` (default `merge`).

```ts
200 → { state: 'merged' }
409 → 'merge_failed'   // GitHub 405 (not mergeable) or 409 (head moved)
502 → 'github_unavailable'
```

### `POST .../auto-merge` / `DELETE .../auto-merge`

Enable / disable auto-merge (GraphQL; needs the mirrored node id). Enable body
`{ method?: 'merge' | 'squash' | 'rebase' }`.

```ts
200 → { autoMergeEnabled: boolean }
409 → 'node_id_unknown'        // open the PR first to mirror its node id
422 → 'auto_merge_not_allowed' // enable only; GraphQL refused
502 → 'github_unavailable'
```

### `POST .../:action{close|reopen}`

```ts
200 → { state: 'closed' | 'open' }
502 → 'github_unavailable'
```

### `POST .../draft`

Body `{ draft?: boolean }`. GraphQL; needs the mirrored PR node id.

```ts
200 → { draft: boolean }
409 → 'node_id_unknown'
502 → 'github_unavailable'
```

### `POST .../comments`

Add a discussion comment. Body `{ body: string }`.

```ts
200 → { id, author, body, createdAt }
400 → 'empty_body'
502 → 'github_unavailable'
```

### `POST .../labels` / `DELETE .../labels`

Add or remove a label. Body `{ name: string }`. Returns the PR's full label set (mirror replaced).

```ts
200 → { name, color }[]
400 → 'empty_name'
502 → 'github_unavailable'
```

### `POST .../reviews`

Submit a PR review. Body `{ event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body? }` (`body`
required for `REQUEST_CHANGES` / `COMMENT`).

```ts
200 → { ok: true }
400 → 'bad_request' | 'body_required'
502 → 'github_unavailable'
```

### `POST .../requested-reviewers` / `DELETE .../requested-reviewers`

Request or remove a reviewer. Body `{ login: string }`. Returns the PR's full requested-reviewer set.

```ts
200 → string[]
400 → 'empty_login'
502 → 'github_unavailable'
```

### `POST .../viewed`

Toggle a file's "viewed" checkbox (**App-state**, no GitHub call). Body `{ path, viewed }`.

```ts
200 → { path, viewed }
400 → 'bad_request'
```

### `POST .../review-comments`

Start a new inline review comment on a line. Needs the mirrored head sha. Body
`{ body, path, line, side? }` (`side` default `RIGHT`).

```ts
200 → { ok: true }
400 → 'bad_request'
409 → 'head_sha_unknown'   // open the PR first to mirror head sha
502 → 'github_unavailable'
```

### `POST .../review-comments/:commentId/replies`

Reply to an existing thread. `:commentId` is the numeric `databaseId`. Body `{ body: string }`.

```ts
200 → { ok: true }
400 → 'empty_body'
502 → 'github_unavailable'
```

### `POST .../threads/:threadId/resolve`

Resolve / unresolve a thread (GraphQL, by thread node id). Body `{ resolved: boolean }`.

```ts
200 → { resolved: boolean }
502 → 'github_unavailable'
```

### `POST /v2/p/github/repos/:owner/:repo/actions/:runId/rerun`

Rerun a workflow run's failed jobs. **Repo-scoped** — `:runId` is the Actions run id (from a check's
`runId`), not a PR number. No mirror to update.

```ts
200 → { ok: true }
401 → 'unauthenticated' | 'reauth'
403 → 'forbidden'
502 → 'github_unavailable'
```

---

## Actions reads (`/v2/p/github/repos/:owner/:repo/actions/...`)

`plugins/github/src/server/routes/actions.ts`. Read-only Actions endpoints for the checks side panel
(**GitHub**; no mirror — the client query cache covers reuse). Writes (rerun) live in `prActions.ts`
above.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v2/p/github/repos/:owner/:repo/actions/runs/:runId/jobs` | A run's jobs + their steps → `{ jobs: WorkflowJob[] }`. |
| `GET` | `/v2/p/github/repos/:owner/:repo/actions/jobs/:jobId/logs` | One job's full plaintext log → `{ text }` (follows GitHub's signed-blob redirect manually, re-fetching **without** the auth header; a non-redirect 2xx — e.g. logs not ready — returns the raw body as `text`). |

`401 unauthenticated|reauth`, `502 github_unavailable`.

---

## Create PR (`/v2/p/github/repos/:owner/:repo/...`)

`plugins/github/src/server/routes/prCreate.ts`. Create-a-PR support. Branch/compare reads are
**GitHub** proxies (no mirror — they change too often); the create busts the open-pulls sync state so
the list refetches.

| Method | Path | Purpose | Body / params |
| --- | --- | --- | --- |
| `GET` | `/v2/p/github/repos/:owner/:repo/branches` | Branch names for head/base pickers, newest-first (100 most-recent). GraphQL: pages through branch refs (up to 30 pages / 3000 branches), sorts by tip `committedDate` server-side. | → `{ name }[]` |
| `GET` | `/v2/p/github/repos/:owner/:repo/compare` | `base..head` → diff preview + commits + `aheadBy`. | `?base=&head=` → `Compare` |
| `POST` | `/v2/p/github/repos/:owner/:repo/pulls` | Create the PR. | `{ title, body?, base, head, draft? }` → `{ number }` |

Errors: `400 bad_request` (missing title/base/head), `401 reauth`, `422 <github message>` (PR exists /
no commits / bad branch — GitHub's message is surfaced verbatim), `502 github_unavailable`.

---

## Mentions (`/v2/p/github/repos/:owner/:repo/mentions`)

`plugins/github/src/server/routes/mentions.ts`. Participant logins for `@`-autocomplete — **Mirror**-only
(distinct authors across mirrored PRs / reviews / comments / threads; unknown repo → `[]`).

```ts
200 → string[]   // sorted, deduped
```

---

## Error codes {#error-codes}

Every error body is the nested `ApiError` envelope (see [Conventions](#conventions)); the values below
are the stable machine `code`s, and `message` (when a route supplies prose) carries the human/upstream
text.

`packages/protocol/src/errors.ts` defines ten **transport** codes — `bad_request`, `unauthorized`,
`forbidden`, `not_found`, `revision_conflict`, `idempotency_conflict`, `provider_error`,
`rate_limited`, `timeout`, `internal` — used verbatim for failures with no domain meaning, and used as
the fallback `codeForStatus()` picks when a route names none. That set is a **floor, not a whitelist**:
a route may return its own documented code, which is why the table below is longer than ten. Client
behaviour hangs off several of these domain codes (`needs-trust` opens the config-trust modal,
`provider_needs_auth` rewrites the message), so collapsing them would delete real behaviour — see
[vNext/phase1-notes.md](./vNext/phase1-notes.md).

| Code | Error | Meaning |
| --- | --- | --- |
| `400` | `bad_number`, `bad_request`, `bad_numbers`, `bad_files_mode`, `bad_paths`, `too_many_paths`, `empty_body`, `empty_name`, `empty_login`, `body_required` | Malformed request |
| `400` | `idempotency_key_required` | A route that demands an `Idempotency-Key` (agent session create, turn enqueue, request resolve) got none |
| `400` | `provider_bad_config`, `provider_secret_unreadable`, `cannot_delete_default` | Provider configuration / workspace guardrails |
| `401` | `unauthenticated` | No resolved principal — no valid device bearer and no valid internal token |
| `401` | `pairing_failed` | `POST /v2/pair` refused, for any reason (deliberately indistinguishable) |
| `401` | `reauth` | GitHub returned `401`, or GitHub is not connected at all — the stored credential is missing, revoked or expired |
| `401`/`403` | `provider_not_connected`, `provider_needs_auth`, `provider_missing_scope` | Provider connection/capability state |
| `403` | `forbidden` | GitHub `403` (insufficient scope/permission, e.g. rerun-failed-jobs) |
| `403` | `interactive_user_required` | A non-`device` principal (an internal child process) attempted to use the HTTP client |
| `403` | `sso` | GitHub `403` requiring SAML SSO authorization (`x-github-sso` header) |
| `404` | `repo_not_found`, `pull_not_found`, `not_found`, `provider_resource_not_found`, `provider_resource_deleted` | Resource not in the local mirror / not on the provider / not visible to this principal kind |
| `409` | `merge_failed` | Not mergeable (GitHub 405) or head moved (409) |
| `409` | `node_id_unknown`, `head_sha_unknown` | Mirror lacks node id / head sha — open the PR first |
| `409` | `needs-trust`, `config-changed` | Repo-authored executable config has not been acknowledged at its current hash |
| `409` | `duplicate_name`, `idempotency_conflict` | Local uniqueness conflict / an `Idempotency-Key` reused with a different request |
| `409`/`422` | `docker_unavailable`, `docker_conflict`, `docker_failed` | Docker CLI/daemon/action failure |
| `422` | `auto_merge_not_allowed`, `validation_failed` | GraphQL/REST validation refusal (auto-merge, create PR). Create-PR puts GitHub's verbatim 422 prose in `message` |
| `422` | `send_failed` | HTTP-client URL/secret/command preparation failed before a request was sent |
| `429` | `rate_limited` | GitHub primary/secondary rate limit, or too many pairing attempts |
| `502` | `github_unavailable` | Any other non-OK GitHub response (incl. GraphQL mutation errors) |
| `502` | `graphql` | Composite/batch GraphQL query returned errors (joined into `message`) |
| `403`/`429`/`502` | `provider_resource_forbidden`, `provider_rate_limited`, `provider_unavailable` | Provider resource or upstream failure |
| `500` | `failed` (prose in `message`) | Harness route whose bridge call threw an unclassified error |
| `500` | `internal` | Any route that threw an uncaught error — the app-level `onError` backstop; the message and stack stay server-side under the `requestId` |
| `503` | `bridge-unavailable`, `capability_unavailable` | Required service-process engine or injected bridge/controller is absent (e.g. `dev:node`) |

> The `401`/`429`/`403`(`forbidden`/`sso`) rows are produced by the shared `ghError()` helper in
> `plugins/github/src/server/index.ts`, applied uniformly across every GitHub-backed route.
> Endpoint-specific statuses (merge `405`/`409`, GraphQL `errors`, create-PR `422`) are handled by the
> route before it delegates the rest to `ghError()`. Any GitHub-backed route may additionally return
> `rate_limited` / `sso` / `forbidden` per this table.

> **There is no client-side `401` bounce.** A `401 unauthenticated` means *this device was revoked*,
> which the broker observes and reports as a node state (`nodeBroker.ts`) rather than something a query
> error navigates on. A route-level `401`/`403` about a third-party credential — `reauth`,
> `provider_not_connected`, `provider_needs_auth` — is a different thing entirely and is handled by the
> feature that asked.

---

## Source

- Route mount map: `packages/node-core/src/server/index.ts` (core routers, middleware order) +
  `packages/node-core/src/server/routeRegistry.ts` (the `/v2/p/<plugin>` projection), with the
  contributions themselves in `apps/node/src/server/routes.ts` and `providers.ts`
- Listener: `packages/node-core/src/main/server.ts`
- Middleware: `packages/node-core/src/server/middleware/auth.ts`, `requireUser.ts`, `idempotency.ts`,
  plus `requestIdMiddleware` / `respondError` in `packages/node-core/src/server/respond.ts`
- Core routes: `packages/node-core/src/server/routes/*`; plugin routes:
  `plugins/<name>/src/server/routes/*`
- Shared contract: `packages/protocol/src/api.ts` (+ `api.test.ts`); error envelope:
  `packages/protocol/src/errors.ts`; WebSocket frames: `packages/protocol/src/ws.ts`

**See also:** [authentication](./authentication.md) · [data-layer](./data-layer.md) ·
[caching](./caching.md) · [github-integration](./github-integration.md) ·
[integrations](./integrations.md) · [mcp](./mcp.md) ·
[notes-and-memory](./notes-and-memory.md) · [architecture-overview](./architecture-overview.md) ·
[docker](./docker.md) · [http-client](./http-client.md)

---
