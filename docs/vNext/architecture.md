# Architecture

## Topology

```text
┌───────────────────────── Acorn Desktop (Electron) ─────────────────────────┐
│ fleet store · layouts · per-node caches · plugin client UI                 │
└──────────────┬──────────────────────────────┬──────────────────────────────┘
               │ HTTPS + WebSocket (/v2)      │ HTTPS + WebSocket (/v2)
               │ device token                 │ device token
┌──────────────▼──────────────┐   ┌───────────▼──────────────┐
│ bundled local Node          │   │ remote Node              │
│ core.sqlite + plugin DBs    │   │ core.sqlite + plugin DBs │
│ worktrees · PTYs · agents   │   │ worktrees · PTYs · agents│
└─────────────────────────────┘   └──────────────────────────┘
```

One protocol, two deployments. The desktop app spawns and supervises a local Node and connects to
it over loopback exactly the way it connects to a remote Node over the LAN/VPN. There is no
privileged local fast path for product features; the only local extras are supervision (start,
stop, crash restart) and the bootstrap handoff of the endpoint + device token.

A Node keeps working when no client is connected (agents finish turns, workflows run, tmux
sessions persist).

## Repo layout

```text
apps/
├── desktop/        @acorn/desktop   Electron client + packaging
└── node/           @acorn/node      the Node service + standalone distribution

packages/
├── protocol/       @acorn/protocol      Zod schemas + TS types for everything on the wire
├── node-core/      @acorn/node-core     Node runtime: server, auth, DB, brokers, registries
├── client-core/    @acorn/client-core   client runtime: shell, fleet store, registries, shared UI
└── plugin-api/     @acorn/plugin-api    the interfaces a plugin implements (node + client)

plugins/
├── github/         @acorn/plugin-github
├── terminal/       @acorn/plugin-terminal
├── agents/         @acorn/plugin-agents
└── ... one package per feature (20 total, see plugin-inventory.md)
```

Dependency direction (enforced by boundary tests):

```text
packages/protocol ─► everything
packages/plugin-api ─► plugins, apps
packages/node-core ─► apps/node
packages/client-core ─► apps/desktop
plugins/* ─► apps (composition roots import plugin entrypoints)
```

- `apps/*` are composition roots: they import plugin entrypoints and register them. Nothing
  imports from `apps/*`.
- A plugin may import `@acorn/protocol`, `@acorn/plugin-api`, and other plugins' **published
  contract entrypoints only** (`@acorn/plugin-x/contract`). Never another plugin's internals.
- `apps/desktop` never imports `apps/node` source. The desktop build embeds the built Node
  artifact and spawns it as a child process.
- Contracts are Zod schemas in `@acorn/protocol` — the single source of truth for wire types.
  No OpenAPI/AsyncAPI/codegen pipeline; every consumer is TypeScript.

## What runs where

| Concern | Owner |
| --- | --- |
| Workspaces, repos, tasks, worktrees, Git, files | Node |
| PTYs, child processes, tmux, Docker, agents, workflows | Node |
| SQLite (core + per-plugin), blobs, secrets | Node |
| Command validation, authorization, mutation commit | Node |
| Pairing grants, device list, revocation | Node |
| Fleet membership (which nodes I know), node labels | Client |
| Layout, pane weights, focus, drafts, keybindings, theme | Client |
| Per-node query cache and event cursors | Client (disposable) |
| Windows, dialogs, keychain, native menus, WebContentsView | Electron main |

Electron main stays thin: window management, native dialogs, `safeStorage`, supervision of the
local Node, the node connection broker (below), and the hardened `WebContentsView` host exposed to
plugins as a client-core service. All product logic is in the Node; all product UI is in the
renderer.

## How the client talks to nodes

This is the one place vNext differs structurally from V1's "renderer served by the server,
same-origin cookie" model, so it's spelled out:

- The renderer is **bundled with the desktop app** and loads from a custom app scheme
  (`app://acorn`), not from a Node. It must reach N nodes cross-origin over self-signed TLS with
  bearer tokens.
- All node traffic goes through a **connection broker in Electron main**: the renderer calls a
  narrow preload API (`nodeFetch(nodeId, req)`, `nodeSocket(nodeId)`), and main performs the
  actual HTTPS/WS using Node.js networking. Certificate pinning is trivial there (compare the
  presented cert against the stored fingerprint for that nodeId — no Chromium cert-store games),
  and device tokens stay in main + keychain; **the renderer never holds a token**.
- The Node therefore serves no CORS headers and no web assets; its only clients are brokers and
  (later, if ever) other trusted tooling.
- Cost we accept: TLS + broker on the loopback path too. One code path for local and remote is
  the point of the architecture; the local overhead is negligible.

## Inside the Node

The Node is a single process (plus the child processes it supervises): Hono HTTP/WS server on top
of a set of core services. Plugins register into it at startup; there is no dynamic loading.

Core services (in `@acorn/node-core`):

- **identity & auth** — nodeId, TLS cert, pairing, device tokens, revocation.
- **db** — core.sqlite (Drizzle), plus a factory that hands each plugin its own database file and
  runs that plugin's migrations.
- **events** — in-process pub/sub fanned out to connected clients over WS (see protocol.md).
- **process broker** — spawn/supervise child processes and PTYs with policy (cwd confinement,
  env allowlists, kill trees). Terminal, agents, docker, workflows all go through it.
- **git/worktree service** — clone/fetch/branch/worktree/status/diff for task repos.
- **file service** — confined read/write/search (ripgrep) inside worktrees.
- **secret store** — encrypted at rest; plugins get use-scoped access, never a dump-all API.
- **http client service** — outbound HTTP for integrations with per-plugin host allowlists.
- **config trust** — hash-gated acknowledgement of executable repo config (`.acorn/*`), as in V1.
- **scheduler** — cron/interval jobs for plugins (mirror refresh, workflow triggers, usage probes).

Startup: open + migrate core DB → recover interrupted operations → init plugins (each opens its
DB, runs its migrations, registers routes/events/jobs) → bind listeners → ready. An optional
plugin that fails to init is disabled for the session and reported; the Node still starts. A
**required** plugin (github, terminal, agents) failing init fails startup — core assumes their
capabilities exist, so a half-node would lie. Shutdown drains
in-flight work with a bounded timeout (30s), same as V1's shutdown draining.

## Fleet semantics

- Every resource ID the client handles is paired with its `nodeId`. Cache keys, routes, layout
  keys — all `(nodeId, id)`. Two nodes may coincidentally hold the same UUID; that must never
  collide in the client.
- Aggregate surfaces (Agent Center, attention, search) fan out per-node requests with per-node
  timeouts and merge results. A slow or offline node yields a partial-result banner, never a
  failed page.
- A mutation targets exactly one node — the one that owns the resource. "Apply to all nodes" is a
  client-side loop with per-node results, and the UI never claims atomicity across nodes.
- Node connection states: `online`, `degraded` (WS down, HTTP up, or high error rate),
  `offline`, `incompatible` (protocol major mismatch), `revoked`. Cached data from a
  non-online node renders with a stale badge.
- Moving a workspace between nodes is out of scope for the first release. The escape hatch is
  manual: create the workspace on the other node and re-clone.

## Failure behavior

- Local Node crash: Electron restarts it with backoff (1/2/4/8/16s, max 5 in 10 min), then shows a
  recovery screen (Retry / Diagnostics / Open data folder / Quit). It never silently creates a
  fresh data root.
- Remote Node unreachable: its resources render from cache with stale/offline badges. No offline
  mutation queue — unsent edits stay as local drafts the user resubmits.
- WS drop: client reconnects with backoff, then refetches (see protocol.md § Events). Terminal
  panes show a disconnected state and disable input until reattached.
- Plugin crash on the Node (thrown error in route/job): contained per request/job; a plugin whose
  init fails is disabled for the session. Plugins run in-process — we accept that a hard native
  crash (segfault in a native dep) takes the Node down and supervision restarts it.
