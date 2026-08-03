# Architecture Overview

> **Removed.** The bearer-authenticated public automation API (`/api/v1`), its tokens,
> idempotency store and second listener were deleted in vNext Phase 0 — along with
> `oauth_accounts`, `api_tokens`, `api_idempotency` and `command_executions`. Passages below
> that describe it are historical. See [vNext/plan.md](./vNext/plan.md).

The keystone doc for acorn: what it is, the client/node model, the two kinds of
state it holds, the three caches reads pass through, and how a request flows end
to end. See the [documentation index](#documentation-index) at the bottom for
everything else.

## What acorn is

acorn began as a **GitHub pull-request review tool** and has grown into a **local
macOS agent workspace**: a keyboard-driven desktop app for reviewing PRs *and*
driving coding agents (Claude Code, Codex, aider) against your repositories, each
in its own git worktree.

It is a SolidJS single-page app that ships **inside** the Electron app and loads
from the bundled `app://acorn` origin. It talks to one or more **nodes** — a Hono
server (via `@hono/node-server`) over HTTPS, each owning a data root with a local
SQLite read-model mirror of GitHub and an on-disk blob cache — through a
connection broker in Electron main. IndexedDB persists the client query cache, one
partition per node. acorn started life as a Cloudflare Worker and migrated to
Electron; the app design (Hono app, Drizzle schema, SolidJS UI) is unchanged, only
the host — see [electron.md](./electron.md) for that history, and note that any
lingering references to Workers / D1 / KV / wrangler describe the *prior* runtime.

One user, but no longer necessarily one machine: the client is deliberately
multi-node (vNext Phase 1), and a node is reachable over a LAN. The steady state
for most people is still exactly one node — the bundled local one — and nothing in
first-run mentions nodes at all.

The two halves of the product share a spine. PR review reads GitHub into a local
mirror and renders it fast; the agent workspace opens a git worktree per unit of
work and gives an agent task-scoped context over the same node. Both are the same
app: one window, one database per node.

## A client, and N nodes

The Electron main process boots through a thin native composition root
(`apps/desktop/src/app/main/bootstrap.ts`, called once from `electron.ts`). It
spawns and supervises one Node **child process** — `spawn(process.execPath, [entry],
{ env: { ELECTRON_RUN_AS_NODE: '1' }, stdio: [..., 'ipc'] })`, an ordinary Node IPC
channel rather than Electron's `utilityProcess` — installs the native preview and
folder-picker adapters and the connection broker, then creates the window once the
service reports that its listener is up. The node's composition root
(`apps/node/src/service/runtime.ts`) migrates the DB, constructs domain services,
installs bridge-backed capabilities, then starts a single Hono app
(`packages/node-core/src/server/index.ts`, a `createApp()` factory) under
`@hono/node-server`.

That listener is **HTTPS with `minVersion: 'TLSv1.3'` on an ephemeral port**. The
pinned `4317` existed so the renderer's browser origin — and therefore its
IndexedDB — stayed stable; the renderer has no origin on the node any more, and a
pinned port makes two nodes on one machine impossible. `service.start` reports
`{ nodeId, endpoint, deviceToken, fingerprint, certPem }` back to main, so the
client is *told* where the node bound rather than assuming. `ACORN_PORT` still
forces a port for tests and `dev:node`; otherwise the last bound port is remembered
in `node.json` and falls back to ephemeral when something else has taken it.

Durable-state reconciliation continues in the node after the listener is
available, off the window paint path. `will-quit` asks the service to drain its
listener and process-backed resources before Electron terminates it. Unexpected
exits are retried with bounded exponential backoff (see
[electron.md](./electron.md) §11).

**The node serves no web assets** — not the shell, not `dist/client`, and it has no
SPA fallback; an unmatched path gets Hono's plain 404. The renderer's bytes belong
to Electron main: `main/appScheme.ts` registers the `app://acorn` protocol over
`dist/client`, serves `index.html` for any path that is not a file on disk (so
client-side deep routes like `/:owner/:repo/:number` survive a hard reload), and
sets the CSP as a response header. A loopback **Host** guard on the node rejects any
`Host` other than the `127.0.0.1:<bound port>` it actually bound, so a
DNS-rebinding page cannot reach the local API as some other origin.

So the node serves exactly one thing: `/v2`. `/v2/core/*` for core routers,
`/v2/p/<plugin>/*` for registry-projected plugin routers, plus one authenticated
WebSocket at `/v2/events`.

The process boundary is deliberately narrower than the HTTP application boundary:

- **The node owns domain/runtime state:** SQLite and migrations, the HTTP listener,
  WebSocket fan-out, PTYs/tmux, worktrees, Git and child processes, workflows, Docker, Postgres
  pools, notes/memory/context, agent tools, reconciliation, and shutdown draining.
- **Electron main owns native state and the connection broker:** `BrowserWindow`,
  `WebContentsView`, folder dialogs, `safeStorage`, navigation/keyboard policy, service
  supervision — and every node endpoint, pinned certificate, device token and `fleet.json`
  (`main/nodeBroker.ts`, `fleetStore.ts`, `deviceTokenStore.ts`, `nodePairing.ts`).
- **Typed RPC connects them:** `@acorn/protocol/serviceProtocol.ts` validates versioned
  request/response/event envelopes in both processes. `@acorn/protocol/desktopCapabilities.ts` exposes
  only narrow task-addressed preview/browser operations. `@acorn/protocol/broker.ts` carries the
  renderer↔main node contract. No DB handle, process object, or `webContents` identifier crosses
  the boundary.

Main waits for `service.start` before opening the window. If the child exits unexpectedly after
startup it applies bounded exponential restart, reloads the renderer after recovery, and shows a
recovery screen once the crash budget is spent. This supervision protocol is lifecycle and
native-capability plumbing; product data rides HTTP/WebSocket from main outward.

### How the client reaches a node

The renderer holds **no credential and no certificate**, and under `app://acorn`'s CSP
(`connect-src 'self'`) it cannot open a connection to a node at all. Instead it calls
`window.acorn.nodeFetch(nodeId, request)` / `nodeSend(nodeId, frame)` over the preload bridge;
Electron main performs the real HTTPS with a pinned `https.Agent` and attaches the device bearer
itself. Certificate pinning becomes a short comparison in Node rather than a fight with Chromium's
certificate store, and the token stays where the renderer cannot read it. This inverts what the
preload file used to say — request/response *and* streams both ride IPC now.

All server-side local state for a node — `core.sqlite` (**not** V1's `acorn.sqlite`), the `blobs/`
cache, per-task `worktrees/`, `tls/`, `logs/`, `node.json`, `node.lock`, notes/proposals, and the
internal-token/active-identity files — lives under one data root:
`app.getPath('userData')` in packaged builds, `apps/node/.acorn/` in a checkout (gitignored).
`openDataRoot` mints the `nodeId`, takes an exclusive pidfile lock, and refuses a directory holding a
V1 database outright — vNext never migrates V1 data.

Authentication is a **device token** bearer, not a cookie: there is no session, no login and no CSRF
middleware, because there is no ambient credential left to defend. See
[authentication](./authentication.md).

The HTTP API contract is mirrored into shared TypeScript, not a runtime RPC
client. `packages/protocol/src/api.ts` owns response types, route builders, and
query-key factories that the SPA consumes through the thin `apiClient.ts` over the
broker. That keeps the route and cache contracts typed without adding client bundle
weight or extra per-request abstraction. See
[api-reference](./api-reference.md) for the full route map, and
[vNext/phase1-notes.md](./vNext/phase1-notes.md) for where the shipped transport
deliberately stops short of the vNext design docs.

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
  attention/unread state, transcript import and launch. New sessions still
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
(`capabilities()`, `packages/client-core/src/capabilities.ts` — the old
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
| Automation | `workflow_runs`, `workflow_steps`, `config_acks` |
| Transport | `devices` (paired clients, secret hashed), `idempotency` (device-keyed replay rows, 24h) |
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
Renderer (SolidJS SPA on app://acorn)
  │  TanStack Query (one client per node): render from IndexedDB if present, then fetch
  ▼
window.acorn.nodeFetch(nodeId, '/v2/p/github/repos/:owner/:repo/pulls')
  │
Electron main: connection broker
  │  pinned https.Agent + Authorization: Bearer acorn_dt_…
  ▼
Hono app on the node (HTTPS, TLS 1.3, ephemeral port)
  │  authMiddleware → requireUser → idempotency: bearer → principal.userId
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
under `<dataRoot>/worktrees/` (`apps/node/.acorn/worktrees/` in a checkout), so several agents can work different
branches of the same repo without colliding. **Managed Claude/Codex sessions** are structured
protocol processes owned by the Agents plugin in the node. Their normalized,
append-only event ledger and query projections share the app's SQLite connection. Raw shell/agent
sessions remain PTYs managed by `plugins/terminal/src/main/terminal.ts`.

Managed turns receive immutable context snapshots through pane contribution registries; raw agents
also get task-scoped tools through the **acorn MCP server**
(`packages/node-core/src/mcp/server.ts`) over loopback HTTPS. The stdio MCP proxy runs as a spawned
child process and calls the running node rather than opening the database itself. Because it holds
no device token, the node loads or creates one persistent mode-`0600`
`INTERNAL_TOKEN` and injects it (with the other `ACORN_*` env vars) into each task session —
alongside `ACORN_DATA_DIR`, from which the child resolves the node's *current* port out of
`node.json`, and `NODE_EXTRA_CA_CERTS`, which is how it validates the node's certificate fully with
no code of its own. The token is bound to the explicit `active-identity` written when GitHub is
connected, so the agent's MCP calls authenticate back to the current machine owner. Note that this
principal now *can* reach GitHub — see the posture note in
[vNext/phase1-notes.md](./vNext/phase1-notes.md). Through that channel the
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
  webhook delivery run only while the node is alive.
- **No session and no login** — there is no cookie, no session store and no accounts. A client
  presents a device-token bearer per request; the node holds `devices` rows and nothing else about
  who is asking.
- **No credential in the renderer** — no device token, no certificate, no GitHub token. Under
  `app://acorn`'s CSP the renderer cannot reach a node directly at all.
- **No second listener and no second domain backend** — one node owns data and domain operations
  behind one `/v2` listener. Electron main is a native UI/supervision host plus the connection
  broker, and the stdio MCP child is a thin proxy, not a database owner.
- **Single user, no multi-tenancy** — no shared storage to protect; locally-owned tables are
  machine-scoped accordingly. Single *machine* is no longer part of the claim: the client is
  multi-node, though every node still belongs to the same one owner.

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
  GitHub OAuth App setup for the device flow, local SQLite/blob state, the ABI gotcha.
- [authentication](./authentication.md) — device tokens, pairing, TLS pinning, the GitHub device
  flow, and why there is no cookie and no CSRF middleware.
- [security](./security.md) — loopback threat model, authentication boundaries,
  filesystem containment, secret handling, and tool permissions.
- [testing](./testing.md) — test suites, architecture checks, and validation commands.
