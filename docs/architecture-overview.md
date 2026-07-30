# Architecture Overview

The keystone doc for acorn: what it is, the one-server model, the two kinds of
state it holds, the three caches reads pass through, and how a request flows end
to end. See the [documentation index](#documentation-index) at the bottom for
everything else.

## What acorn is

acorn began as a **GitHub pull-request review tool** and has grown into a **local
macOS agent workspace**: a keyboard-driven desktop app for reviewing PRs *and*
driving coding agents (Claude Code, Codex, aider) against your repositories, each
in its own git worktree.

It is a SolidJS single-page app served by one Hono server running in an Electron
utility process (via `@hono/node-server`), backed by a local SQLite read-model
mirror of GitHub, an on-disk blob cache, and IndexedDB client persistence.
Everything runs on one machine for one user. acorn started life as a Cloudflare
Worker and migrated to Electron; the app design (Hono app, Drizzle schema,
SolidJS UI) is unchanged, only the host — see [electron.md](./electron.md) for
that history, and note that any lingering references to Workers / D1 / KV /
wrangler describe the *prior* runtime.

The two halves of the product share a spine. PR review reads GitHub into a local
mirror and renders it fast; the agent workspace opens a git worktree per unit of
work and gives an agent task-scoped context over the same loopback server. Both
are the same app: one origin, one database, one window.

## One local server, one origin

The Electron main process boots through a thin native composition root
(`apps/desktop/src/app/main/bootstrap.ts`, called once from `electron.ts`). It
starts and supervises one Node utility process, installs the native preview and
folder-picker adapters, then creates the window after the service reports that
its listener is up. The utility-process composition root
(`apps/desktop/src/app/service/runtime.ts`) migrates the DB, constructs domain
services, installs bridge-backed capabilities, then starts a single Hono app
(`apps/desktop/src/core/server/index.ts`, a
`createApp()` factory) under `@hono/node-server` on `http://127.0.0.1:4317` (the
port is pinned for a stable browser-storage origin; `ACORN_PORT` in the
environment overrides it).
The Electron host then points a hardened `BrowserWindow` at that origin.
Durable-state reconciliation continues in the utility process after the listener
is available, off the window paint path. `will-quit` asks the service to drain
its listeners and process-backed resources before Electron terminates it.
Unexpected exits are retried with bounded exponential backoff (see
[electron.md](./electron.md) §11). The server serves three things from the same
origin:

- the SPA shell and static assets (`dist/client`),
- the `/api/*` JSON API, and
- the `/auth/*` OAuth flow.

Routing lives in `apps/desktop/src/core/main/server.ts`: a static-file middleware
serves the built assets, and a `notFound` handler returns 404s for unmatched
`/api/*` and `/auth/*` but falls back to `index.html` for other paths so the
client router can handle deep links (`/:owner/:repo/:number`). A loopback Host
guard rejects unexpected `Host` headers (only `127.0.0.1:4317` is accepted —
`localhost` was deliberately dropped; everything standardises on the
`127.0.0.1` form) so a DNS-rebinding page can't reach the local API as some
other origin.

The process boundary is deliberately narrower than the HTTP application boundary:

- **Utility service owns domain/runtime state:** SQLite and migrations, both HTTP listeners,
  WebSocket fan-out, PTYs/tmux, worktrees, Git and child processes, workflows, Docker, Postgres
  pools, notes/memory/context, agent tools, reconciliation, and shutdown draining.
- **Electron main owns native state:** `BrowserWindow`, `WebContentsView`, folder dialogs,
  `safeStorage`, navigation/keyboard policy, and service supervision.
- **Typed service RPC connects them:** `core/shared/serviceProtocol.ts` validates versioned
  request/response/event envelopes in both processes. `core/shared/desktopCapabilities.ts` exposes
  only narrow task-addressed preview/browser operations. No DB handle, process object, or
  `webContents` identifier crosses the boundary.

Main waits for `service.start` before opening the window. If the child exits unexpectedly after
startup it applies bounded exponential restart, reloads the renderer after recovery, and fails
closed after more than three crashes in one minute. This supervision protocol is lifecycle and
native-capability plumbing; renderer product data still uses HTTP/WebSocket.

All server-side local state — the SQLite DB (`acorn.sqlite`), the `blobs/`
cache, per-task `worktrees/`, notes/proposals, and the internal-token/active-identity
files — lives under one data root:
`app.getPath('userData')` in packaged builds, `apps/desktop/.acorn/`
(gitignored).

Because the API and the app share an origin, the session is a plain same-origin
cookie — no CORS, no bearer tokens in the browser, no token storage on the client
at all. See [authentication](./authentication.md). (A separate, opt-in
[public automation API](./public-api.md) runs a second `127.0.0.1` listener on
its own port with bearer-token auth; it is disabled by default and does not
change the SPA origin.)

The HTTP API contract is mirrored into shared TypeScript, not a runtime RPC
client. `apps/desktop/src/core/shared/api.ts` owns response types, route builders, and
query-key factories that the SPA consumes through plain same-origin `fetch`.
That keeps the route and cache contracts typed without adding client bundle
weight or extra per-request abstraction. See
[api-reference](./api-reference.md) for the full route map.

## The product model

The UI is organised as a three-level hierarchy plus a docked terminal surface.

```
Workspace ("Runn", "Acorn")            ← group of repos, picked in the top bar
  ├─ Agent Center                      ← workspace-wide managed-session history
  └─ Task (repo + branch + worktree)   ← unit of work, a row in the left TabRail
       ├─ Panes (ordered/resizable row)← agents · pr · changes · notes · editor · …
       │    └─ Agent pane              ← chat + same-task agent/activity sidebar
       └─ Terminal drawer (bottom)     ← shells, raw agents, tool terminals   [desktop]
```

- **Workspace** — a named *group of repos*, the top-level unit picked in the top
  bar. A repo belongs to exactly one workspace (a partition), and the active
  workspace is *derived* from the current repo — there is no separate URL
  dimension. Workspaces carry identity (color + emoji/lucide/github icon); the
  per-repo scripts (setup / dev / dev-restart / teardown / db) plus
  browser-preview config are repo-level (`repo_paths`).
- **Task** — the single-repo *unit of work*: repo + branch + optional git
  worktree + optional linked PR + its panes and terminals. Shown as a row in the
  left **TabRail**. A task's `origin` is one of `github-pr | linear | rollbar |
  local`. (Terminology note: earlier design docs called a Task a "Workspace" —
  it was renamed; Workspace now means the group.)
- **Pane** — a registry-contributed surface inside the Task view. `PaneId` is a
  string owned by a contribution rather than a closed core union. The shipped
  panes include `agents | pr | changes | notes | context | editor | search | database |
  preview | docker | http | linear | rollbar`. A task layout is a flat,
  ordered row with optional relative widths and pins
  (`TaskLayout = { panes, weights?, pinned? }`); one pure reducer owns show/add,
  close/unpin, pin, move, resize/equalize, and recipe replacement.
- **Agent Center** — a workspace source for managed Claude/Codex history, search, provider health,
  attention/unread state, transcript import, launch and outcome comparison. New sessions still
  require a task/worktree.
- **Terminal drawer** — bottom, per-task, holds shells, raw provider TUIs and terminals attached to
  managed tool calls.
- **Agent pane** — the task-level managed conversation and lifecycle surface. Its persistent
  sidebar lists same-task managed sessions, attention requests, raw terminals and workflow work,
  while its header summarizes provider utilization.

**Maturity.** PR review, Workspaces, Tasks, the TabRail, all twelve pane
contributions, the Docker and API Requests sources, notifications, integrations
(Linear and Rollbar), shared model-provider connections (OpenAI and Anthropic),
database tools, settings, the command palette, and the file finder are shipped.
The **terminal drawer, agent sessions, run targets, and workflows** are
desktop-only and always on when the Electron terminal capability is present
(`capabilities()`, `apps/desktop/src/core/client/capabilities.ts` — the old
`acorn:term` localStorage flag has been deleted). The workflow engine is a
registry-backed durable runtime with explicit branching/joins, profile adapters,
tool ceilings, cancellation, and app-open triggers; authoring remains file-only. See
[workspaces-and-tasks.md](./workspaces-and-tasks.md), [panes.md](./panes.md), and
[terminal-and-agents.md](./terminal-and-agents.md).

## Two kinds of state

acorn's SQLite database holds two categories of data with opposite ownership.
Confusing them is the most common way to misreason about the system.

**The mirror — a cache of GitHub, not a source of truth.** acorn never owns
PR/repo data; GitHub does. The mirror exists only to make reads fast and support
offline browsing:

- **Populated on read.** A mirror row exists only because someone fetched that
  resource. There are no webhooks and no background sync jobs — nothing fills the
  mirror ahead of demand.
- **Revalidated, never trusted blindly.** Each read checks freshness. Repos use a
  TTL window; PR lists, detail, and files gate on a TTL recorded in `sync_state`,
  and repos/PR-lists revalidate against GitHub with an ETag where one is
  available (`If-None-Match` → a `304` is free against the rate limit).
- **Disposable.** Mirror rows can be deleted and re-synced at any time. The list
  endpoints delete-then-insert on every refresh so resources the user lost access
  to drop out.

Mirror tables include `repos`, `pull_requests`, `pr_files`, `reviews`,
`comments`, `pr_commits`, `review_threads`, `pr_labels`, `review_requests`,
`checks`, the `sync_state` freshness bookkeeping, and `issues` (Linear/Rollbar
items cached from their providers) with `issue_resources` for provider-list
freshness.

**App-state — data acorn owns.** A separate set of tables are the source of
truth: they survive mirror re-syncs and have no upstream to reconcile against.
These back the product model above and the agent spine:

| Domain | Tables |
| --- | --- |
| Workspaces | `workspaces`, `workspace_repos`, `ignored_repos`, `workspace_projects` |
| Tasks | `tasks`, `task_links` |
| Review | `review_notes` (inline notes on uncommitted changes), `viewed_files` |
| Agents / memory | `agent_sessions`, `agent_turns`, `agent_events` (+ FTS5), `agent_requests`, `agent_attachments`, `agent_artifacts`, `agent_operations`, `agent_webhooks`, `agent_webhook_deliveries`, `memories` (+ FTS5), `terminal_sessions` |
| Automation | `workflow_runs`, `workflow_steps`, `command_executions`, `config_acks` |
| Public API | `api_tokens`, on-demand `oauth_accounts`, `api_idempotency` (bearer automation API) |
| HTTP client | identity-scoped `http_requests`, `http_variables` (sensitive values encrypted at rest) |
| Database | repo-scoped `db_saved_queries` |
| Prefs / misc | `prefs`, `pinned_repos`, `integrations`, `repo_paths` |

Locally-owned entities that own an on-disk artefact (a worktree, a memory file, a
PTY) are **machine-scoped — no `user_id`** — because there is exactly one user on
the machine: `tasks`, `review_notes`, `memories`, and `terminal_sessions` carry
no user column by design. Identity-scoped rows instead carry the canonical
authenticated GitHub login so a login switch cannot inherit another account's
preferences, integrations, saved HTTP requests, or bearer credentials. See
[data-layer](./data-layer.md) for the table-by-table split.

## Three cache layers

Reads pass through up to three caches, each with a different scope and lifetime:

| Layer | Where | Scope | Holds | Lifetime |
| --- | --- | --- | --- | --- |
| SQLite mirror | Local server / SQLite | Per user | Repos, PRs, files, reviews, comments, checks, labels, threads | TTL + ETag (see [caching](./caching.md)) |
| `BLOBS` cache | Local server / on-disk | Per device | Immutable patch/diff bodies keyed by blob SHA | Immutable |
| IndexedDB | Browser | Per user/device | TanStack Query cache (last-known API responses) | `gcTime` 24h, persisted |

The client cache is a stale-while-revalidate layer: it renders instantly from the
last persisted response, then refetches. `gcTime` is set to 24h so persisted
entries survive a reload, which is what enables offline browsing of recently-seen
PRs. See [caching](./caching.md).

## End-to-end data flow

A cold read of a PR list, top to bottom:

```
Browser (SolidJS SPA)
  │  TanStack Query: render from IndexedDB if present, then fetch
  ▼
GET /api/repos/:owner/:repo/pulls           (same-origin cookie)
  │
Hono server (Node utility process)
  │  csrf() + authMiddleware: decrypt session cookie in-CPU → ctx.user
  ▼
SQLite mirror
  │  sync_state fresh within TTL? ──► yes ──► serve mirror rows  ─┐
  │                                                               │
  └─ no/stale                                                     │
        │  conditional fetch with If-None-Match (sync_state.etag) │
        ▼                                                         │
     GitHub REST/GraphQL                                          │
        │  304 ► bump freshness, serve mirror ────────────────────┤
        │  200 ► delete-then-insert rows + update sync_state ─────┤
        ▼                                                         │
     (patch bodies → on-disk BLOBS cache by SHA)                  │
                                                                  ▼
                                                       JSON response
  ▲                                                               │
  └───────────────────────────────────────────────────────────────┘
  Browser caches the response in IndexedDB and renders
```

Writes (merge/close/draft/comment/label/…) follow the same spine in reverse: the
server calls GitHub, then updates (or busts the freshness of) the SQLite mirror
so a read inside the TTL window reflects the change. See
[github-integration](./github-integration.md) and
[api-reference](./api-reference.md).

## The agent spine

When a task first needs a working tree, acorn creates a **git worktree per task**
under `apps/desktop/.acorn/worktrees/`, so several agents can work different
branches of the same repo without colliding. **Managed Claude/Codex sessions** are structured
protocol processes owned by the Agents plugin in the Node utility service. Their normalized,
append-only event ledger and query projections share the app's SQLite connection. Raw shell/agent
sessions remain PTYs managed by `plugins/terminal/main/terminal.ts`.

Managed turns receive immutable context snapshots through pane contribution registries; raw agents
also get task-scoped tools through the **acorn MCP server**
(`apps/desktop/src/core/mcp/server.ts`) over loopback. The stdio MCP proxy runs as a spawned child
process and calls the running app rather than opening the database itself. Because it holds
no session cookie, the utility service loads or creates one persistent mode-`0600`
`INTERNAL_TOKEN` and injects it (with the other `ACORN_*` env vars) into each task session. The
token is bound to the explicit `active-identity` written by cookie-authenticated traffic, so the
agent's MCP calls authenticate back to the current machine user without acquiring a live GitHub
token. Through that channel the
agent reads the assembled task context, the current PR/changes, and the
notes/memory that carry a handoff from the reviewer: `review_notes` become an
agent prompt, and the `memories` index (markdown files are the truth; the table
is a derived, FTS-searchable index) persists conventions and decisions across
sessions.

This section is a map, not the manual — see
[managed-agents.md](./managed-agents.md), [terminal-and-agents.md](./terminal-and-agents.md), [mcp.md](./mcp.md),
[notes-and-memory.md](./notes-and-memory.md), and [workflows.md](./workflows.md)
for the detail. Interactive sessions and workflows are desktop-only; the HTTP-backed agent-tool
projection itself is transport-neutral.

## What acorn deliberately does not have

- **No remote ingestion jobs or hosted daemon** — GitHub mirror reads remain demand-driven.
  Local managed-agent scheduling, workflow reconciliation and optional outbound attention/completion
  webhook delivery run only while the desktop utility service is alive.
- **No server-side session store** — the session lives entirely in an encrypted
  cookie, decrypted per request.
- **No GitHub token in the browser** — only public profile fields cross the wire.
- **No second domain backend** — one utility service owns data and domain operations; its internal
  SPA listener and opt-in public listener project the same registries/services. Electron main is a
  native UI/supervision host and the stdio MCP child is a thin proxy, not a database owner.
- **Single machine, single user** — no multi-tenancy, no shared storage to
  protect; locally-owned tables are machine-scoped accordingly.

## Documentation index

**Architecture & data**

- [architecture-overview](./architecture-overview.md) — this doc: the one-server
  model, the two kinds of state, the three cache layers, the data flow.
- [plugins](./plugins.md) — the core/plugin/app boundaries and contribution registries.
- [data-layer](./data-layer.md) — the Drizzle + SQLite schema table-by-table,
  mirror vs app-state, scoping, staleness bookkeeping, migrations.
- [state](./state.md) — durability tiers, scopes, the ordered restore pipeline,
  persisted-state descriptors, failure handling, and lifecycle eviction.
- [caching](./caching.md) — the three cache layers and their exact policies
  (TTLs, ETag revalidation, on-disk blobs, IndexedDB persistence).
- [api-reference](./api-reference.md) — every route: method, path, params,
  response shape, error codes, and the shared client contract.
- [github-integration](./github-integration.md) — the REST + GraphQL clients,
  the operation → endpoint map, ETag usage and rate limits.

**Features & panes**

- [features](./features.md) — the shipped feature map and desktop capability limits.
- [frontend](./frontend.md) — the SolidJS app, routing, panes, and the shared
  TanStack Query definitions.
- [workspaces-and-tasks](./workspaces-and-tasks.md) — the Workspace/Task model,
  the TabRail, sources, and worktree lifecycle.
- [panes](./panes.md) — the pane set, the flat layout row, and the
  `applyLayoutAction` reducer.
- [command-palette-and-shortcuts](./command-palette-and-shortcuts.md) — the
  command palette, file finder, and keyboard model.
- [diff-rendering](./diff-rendering.md) — how patches are parsed and rendered,
  inline review comments, and viewed-file state.
- [ui-design](./ui-design.md) — layout, theming, and the monospace/flat design
  language.
- [pg](./pg.md) — the Database pane: a native Postgres viewer/editor over
  task-scoped HTTP routes and utility-service pools.
- [docker](./docker.md) — Docker Source/pane, task matching, daemon events, and lifecycle.
- [http-client](./http-client.md) — encrypted API requests, variables, and outbound execution.

**Agents & automation**

- [managed-agents](./managed-agents.md) — structured Claude/Codex sessions, normalized durable
  events, scheduling/recovery, context, safety, UI, public automation and retained terminal fallback.
- [terminal-and-agents](./terminal-and-agents.md) — the terminal drawer, agent
  fallback, raw status, run targets, and the compact agents panel (desktop-only).
- [mcp](./mcp.md) — the acorn MCP server: the task-scoped tools it exposes to
  agents over loopback.
- [notes-and-memory](./notes-and-memory.md) — review notes, the memory index, and
  the reviewer→agent handoff.
- [workflows](./workflows.md) — durable runs/steps, registries, branches, gates,
  tool/budget ceilings, managed sessions, cancellation, and triggers.
- [integrations](./integrations.md) — third-party sources (Linear, Rollbar):
  connect/status, caching, and how they seed tasks.

**Setup & reference**

- [electron](./electron.md) — the Cloudflare Workers → Electron migration: the
  runtime, bindings, packaging, and what changed (and didn't).
- [local-development](./local-development.md) — building and launching the app,
  OAuth callback setup, local SQLite/blob state, the ABI gotcha.
- [authentication](./authentication.md) — GitHub OAuth web flow, the encrypted
  stateless session cookie, CSRF protections, the 401 → reauth bounce.
- [security](./security.md) — loopback threat model, authentication boundaries,
  filesystem containment, secret handling, and tool permissions.
- [public-api](./public-api.md) — the opt-in bearer-authenticated HTTP + WebSocket
  automation API: dedicated listener, token model, schema-first endpoints, OpenAPI.
- [testing](./testing.md) — test suites, architecture checks, and validation commands.
