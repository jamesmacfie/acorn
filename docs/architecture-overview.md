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
main process (via `@hono/node-server`), backed by a local SQLite read-model
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

The Electron main process boots through one composition root
(`apps/desktop/src/main/bootstrap.ts`, called once from `electron.ts`): it
migrates the DB, constructs the domain services, installs their bridges/IPC,
then starts a single Hono app (`apps/desktop/src/server/index.ts`, a
`createApp()` factory) under `@hono/node-server` on `http://127.0.0.1:4317` (the
port is pinned for a stable browser-storage origin; `ACORN_PORT` in the
environment overrides it), and points a hardened `BrowserWindow` at that origin.
Durable-state reconciliation runs after the window, off the paint path, and a
`will-quit` teardown disposes services in reverse (see
[electron.md](./electron.md) §11). The server serves three things from the same
origin:

- the SPA shell and static assets (`dist/client`),
- the `/api/*` JSON API, and
- the `/auth/*` OAuth flow.

Routing lives in `apps/desktop/src/main/server.ts`: a static-file middleware
serves the built assets, and a `notFound` handler returns 404s for unmatched
`/api/*` and `/auth/*` but falls back to `index.html` for other paths so the
client router can handle deep links (`/:owner/:repo/:number`). A loopback Host
guard rejects unexpected `Host` headers (only `127.0.0.1:4317` is accepted —
`localhost` was deliberately dropped; everything standardises on the
`127.0.0.1` form) so a DNS-rebinding page can't reach the local API as some
other origin.

All server-side local state — the SQLite DB (`acorn.sqlite`), the `blobs/`
cache, and per-task `worktrees/` — lives under one data root:
`app.getPath('userData')` in packaged builds, `apps/desktop/.acorn/`
(gitignored).

Because the API and the app share an origin, the session is a plain same-origin
cookie — no CORS, no bearer tokens in the browser, no token storage on the client
at all. See [authentication](./authentication.md).

The HTTP API contract is mirrored into shared TypeScript, not a runtime RPC
client. `apps/desktop/src/shared/api.ts` owns response types, route builders, and
query-key factories that the SPA consumes through plain same-origin `fetch`.
That keeps the route and cache contracts typed without adding client bundle
weight or extra per-request abstraction. See
[api-reference](./api-reference.md) for the full route map.

## The product model

The UI is organised as a three-level hierarchy plus two docked surfaces.

```
Workspace ("Runn", "Acorn")            ← group of repos, picked in the top bar
  └─ Task (repo + branch + worktree)   ← unit of work, a row in the left TabRail
       ├─ Panes (flat left→right row)  ← pr · changes · notes · editor · preview · …
       ├─ Terminal drawer (bottom)     ← persistent shell / agent sessions   [flagged]
       └─ Agents panel (right rail)    ← agent roster + launcher + activity   [flagged]
```

- **Workspace** — a named *group of repos*, the top-level unit picked in the top
  bar. A repo belongs to exactly one workspace (a partition), and the active
  workspace is *derived* from the current repo — there is no separate URL
  dimension. Workspaces carry identity (color + emoji/lucide/github icon) and
  per-workspace scripts (setup / dev / dev-restart / teardown) plus
  browser-preview config.
- **Task** — the single-repo *unit of work*: repo + branch + optional git
  worktree + optional linked PR + its panes and terminals. Shown as a row in the
  left **TabRail**. A task's `origin` is one of `github-pr | linear | rollbar |
  local`. (Terminology note: earlier design docs called a Task a "Workspace" —
  it was renamed; Workspace now means the group.)
- **Pane** — a surface inside the Task view. `PaneId` is one of `pr | linear |
  rollbar | preview | editor | changes | notes | context | database | search`
  (`apps/desktop/src/client/features/tasks/layout.ts`). A task's layout is a flat
  left→right row of open panes (`TaskLayout = { panes: PaneId[] }`); one pure
  reducer `applyLayoutAction` owns every transition (`show` = single pane, `add`
  = open beside via ⌘/Ctrl-click, `close`, `replace`).
- **Terminal drawer** — bottom, per-task, holds persistent shell/agent sessions.
- **Agents panel** — right rail, the roster, launcher, and activity feed for
  agent sessions.

**Maturity.** PR review (list / detail / diff / write actions), Workspaces,
Tasks, the TabRail, panes, notifications, integrations (Linear live, Rollbar),
settings, the command palette, and the file finder are shipped and default-on.
The **terminal drawer, agent sessions, run targets, and workflows** are
desktop-only and always on when the Electron preload bridge is present
(`capabilities()`, `apps/desktop/src/client/features/capabilities.ts` — the old
`acorn:term` localStorage flag has been deleted). The workflow engine
has real scaffolding (schema, harness routes, a read-only inspector) but is in
progress, not a finished orchestrator. See
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
items cached from their providers).

**App-state — data acorn owns.** A separate set of tables are the source of
truth: they survive mirror re-syncs and have no upstream to reconcile against.
These back the product model above and the agent spine:

| Domain | Tables |
| --- | --- |
| Workspaces | `workspaces`, `workspace_repos`, `ignored_repos`, `workspace_projects` |
| Tasks | `tasks`, `task_links` |
| Review | `review_notes` (inline notes on uncommitted changes), `viewed_files` |
| Agents / memory | `memories` (+ `memories_fts` FTS5), `terminal_sessions` |
| Automation | `workflow_runs`, `workflow_steps` |
| Prefs / misc | `prefs`, `pinned_repos`, `integrations`, `repo_paths` |

Locally-owned entities that own an on-disk artefact (a worktree, a memory file, a
PTY) are **machine-scoped — no `user_id`** — because there is exactly one user on
the machine: `tasks`, `review_notes`, `memories`, and `terminal_sessions` carry
no user column by design. The older user-scoped columns on prefs/pins are kept,
with documented semantics (see the comment in `schema.ts`): `user_id` is the
single canonical user id — the authenticated GitHub login — so app state is
pinned to the GitHub identity and a login switch doesn't inherit another
account's state. See [data-layer](./data-layer.md) for the table-by-table split.

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
Hono server (Electron main process)
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
branches of the same repo without colliding. **Agent sessions** are PTYs managed
in the Electron main process (`apps/desktop/src/main/terminal.ts`, registered at
startup); they share the single SQLite connection rather than opening a second.

Agents get task-scoped context through the **acorn MCP server**
(`apps/desktop/src/mcp/server.ts`) over loopback. Because a spawned server holds
no session cookie, the main process mints a per-run `INTERNAL_TOKEN` and injects
it (with the other `ACORN_*` env vars) into each task session, so the agent's MCP
calls authenticate back to the machine's single user. Through that channel the
agent reads the assembled task context, the current PR/changes, and the
notes/memory that carry a handoff from the reviewer: `review_notes` become an
agent prompt, and the `memories` index (markdown files are the truth; the table
is a derived, FTS-searchable index) persists conventions and decisions across
sessions.

This section is a map, not the manual — see
[terminal-and-agents.md](./terminal-and-agents.md), [mcp.md](./mcp.md),
[notes-and-memory.md](./notes-and-memory.md), and [workflows.md](./workflows.md)
for the detail. All of it is desktop-only (bridge-gated, always on).

## What acorn deliberately does not have

- **No webhooks or background jobs** — everything is read-driven. (A background
  triage loop, "Pulse", has been designed but is not shipped.)
- **No server-side session store** — the session lives entirely in an encrypted
  cookie, decrypted per request.
- **No GitHub token in the browser** — only public profile fields cross the wire.
- **No second backend** — one in-process Hono server is the whole backend; the
  MCP server and terminal service run in the same main process against the same
  DB.
- **Single machine, single user** — no multi-tenancy, no shared storage to
  protect; locally-owned tables are machine-scoped accordingly.

## Documentation index

**Architecture & data**

- [architecture-overview](./architecture-overview.md) — this doc: the one-server
  model, the two kinds of state, the three cache layers, the data flow.
- [data-layer](./data-layer.md) — the Drizzle + SQLite schema table-by-table,
  mirror vs app-state, scoping, staleness bookkeeping, migrations.
- [caching](./caching.md) — the three cache layers and their exact policies
  (TTLs, ETag revalidation, on-disk blobs, IndexedDB persistence).
- [api-reference](./api-reference.md) — every route: method, path, params,
  response shape, error codes, and the shared client contract.
- [github-integration](./github-integration.md) — the REST + GraphQL clients,
  the operation → endpoint map, ETag usage and rate limits.

**Features & panes**

- [features](./features.md) — the feature map: what ships, what's flagged, what's
  designed.
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
  per-task IPC connections.

**Agents & automation**

- [terminal-and-agents](./terminal-and-agents.md) — the terminal drawer, agent
  sessions, run targets, and the agents panel (desktop-only).
- [mcp](./mcp.md) — the acorn MCP server: the task-scoped tools it exposes to
  agents over loopback.
- [notes-and-memory](./notes-and-memory.md) — review notes, the memory index, and
  the reviewer→agent handoff.
- [workflows](./workflows.md) — the workflow engine scaffolding: runs, steps, and
  gates (in progress, flagged).
- [integrations](./integrations.md) — third-party sources (Linear, Rollbar):
  connect/status, caching, and how they seed tasks.

**Setup & reference**

- [electron](./electron.md) — the Cloudflare Workers → Electron migration: the
  runtime, bindings, packaging, and what changed (and didn't).
- [local-development](./local-development.md) — building and launching the app,
  OAuth callback setup, local SQLite/blob state, the ABI gotcha.
- [authentication](./authentication.md) — GitHub OAuth web flow, the encrypted
  stateless session cookie, CSRF protections, the 401 → reauth bounce.

**Future work** — [docs/next/](./next/) holds what has *not* been built yet:
[review.md](./next/review.md) (the critical architecture review),
[extensibility.md](./next/extensibility.md) (the plugin-platform design it
motivates, split across three files — see [docs/next/README.md](./next/README.md)),
and [implementation.md](./next/implementation.md) (the staged guide
for building it). The root docs above describe what exists in code today;
superseded design records (the old `vNext.md`, `docs/workspaces/`) have been
removed — see git history for the original rationale.

