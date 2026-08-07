# Architecture overview

acorn is a desktop client for one or more local Node services. The client owns presentation and
fleet membership. A Node owns the data and execution environment for the repositories assigned to
it. There is no shared database or cross-Node transaction.

## Runtime topology

```text
Electron desktop
  renderer: SolidJS shell, panes, query cache, layouts, drafts
  main: app:// scheme, native views/dialogs, safeStorage, broker, supervision
       │ preload IPC
       ▼
connection broker in Electron main
       │ pinned HTTPS + device bearer, one WebSocket per Node
       ├──────────────► bundled local Node
       └──────────────► paired Node

Node
  Hono /v2 server + /v2/events
  core.sqlite + plugin SQLite files + blobs
  Git, worktrees, PTYs, agents, workflows, Docker, provider clients
```

Electron main starts the built `apps/node` artifact with `process.execPath` and
`ELECTRON_RUN_AS_NODE=1`. The Node reports its bound endpoint and certificate fingerprint through
the service protocol. The local Node is supervised and restarted with bounded backoff; a standalone
Node uses the same service graph without Electron-native capabilities.

The Node binds `127.0.0.1` over HTTPS with TLS 1.3. The port is ephemeral unless `ACORN_PORT` is set
or a remembered port in `node.json` is available. The Node serves no web assets. Electron's
`app://acorn` protocol serves the renderer and falls back to its bundled `index.html` for client-side
routes.

## Process ownership

The Node owns:

- core and plugin SQLite connections and migrations;
- workspaces, tasks, repositories, worktrees, Git, files, and repo configuration;
- PTYs, tmux sessions, child processes, managed agents, workflows, Docker, and Postgres access;
- provider integrations, encrypted secrets, mirrors, blob storage, audit, backup, import, and
  reconciliation;
- the HTTPS listener, authenticated WebSocket, stream/tunnel sockets, and shutdown drain.

Electron main owns:

- `BrowserWindow`, `WebContentsView`, dialogs, menus, navigation policy, and `safeStorage`;
- the renderer preload bridge and node connection broker;
- Node endpoint records, certificate pins, device-token custody, fleet membership, and service
  supervision.

Only serializable values cross a boundary. Product requests and streams use the broker and `/v2`;
the service protocol is reserved for lifecycle messages and narrow, task-addressed native
capabilities such as preview/browser operations.

## Node API and client flow

The Node exposes one Hono application:

- `/v2/node` and `/v2/pair` are the two pre-auth pairing routes;
- `/v2/core/*` contains core-owned workspaces, tasks, worktrees, integrations, settings, security,
  backup, import, audit, agent-tool, and task-context routes;
- `/v2/p/<plugin>/*` contains plugin-contributed routes;
- `/v2/events` is the authenticated WebSocket for invalidation events, PTY/process streams, Docker
  streams, workflow notices, agent events, and preview tunnels.

`packages/protocol/src/api.ts` owns route builders, response types, and query keys. The renderer
calls the thin client in `packages/client-core` through `window.acorn.nodeFetch` and stream methods.
Electron main supplies the Node endpoint, pinned HTTPS agent, and bearer token. The renderer never
holds a token or certificate and cannot open a direct network connection under the app CSP.

Every response has an `X-Request-Id`. Errors use the single envelope
`{ error: { code, message, requestId, retryable, details? } }`. Mutations may use
`Idempotency-Key`; session creation, agent turns, and request resolution require one.

## Product model

```text
Workspace: named group of repositories
  └─ Task: one repository, branch, optional worktree and linked external item
       ├─ ordered/resizable panes
       └─ per-task terminal and managed-agent sessions
```

Workspaces are machine-local groups. A repository belongs to one workspace. A task is always owned
by one Node and one repository. Task origins are `github-pr`, `linear`, `rollbar`, or `local`.

The renderer shell is contribution-driven. Plugins register task panes, rail sources, command-palette
rows, settings pages, slots, context sections, attention items, and node statistics. The shipped
feature packages are GitHub, terminal, agents, editor, changes, notes, memory, context, workflows,
database, Docker, HTTP, preview, Linear, Rollbar, model providers, onboarding, and the Claude, Codex,
and Aider profile packages.

## Data ownership

The Node separates disposable provider projections from application-owned state. GitHub, Linear, and
Rollbar data is cached locally and revalidated on demand. Workspaces, tasks, notes, memories, agent
sessions, workflow state, integrations, preferences, repo configuration, saved queries, devices,
and audit records are local source-of-truth data.

Core owns the cross-feature workspace/task model, device and idempotency state, integrations, generic
external-item projections, node preferences, config-trust acknowledgements, and audit records. A
table-owning plugin owns its own SQLite file and migration chain. Plugins do not query one another's
databases or use cross-file foreign keys; cross-plugin references are IDs resolved through typed
CoreServices or capability contracts.

The shared on-disk blob cache stores immutable patch bodies, file bodies, attachments, and artifacts
by content hash. Worktrees and blobs are not included in backups. Backup snapshots core and plugin
databases with credentials and device rows scrubbed; restore is a manual operation into a fresh data
root.

## Client state and fleet behavior

The client has one disposable query cache and IndexedDB persister per Node. It also persists fleet
membership, endpoint pins, device tokens, device preferences, layouts, drafts, and selection state.
Every Node-backed query is rendered with `live`, `refreshing`, `stale`, `offline`, `disabled`, or
`error` status. Cached reads remain visible when a Node is offline; mutations fail fast and retain
the user's text as a draft. There is no automatic mutation queue.

Aggregate surfaces fan out requests per Node with bounded timeouts, merge successful results, and
show partial availability with a Node label. A mutation always targets the Node that owns its
resource. Node IDs are part of cache and persisted-state scope, so identical IDs on different Nodes
cannot collide.

## Agent execution

Managed agent sessions live in the agents plugin and persist normalized events in a durable per-session
sequence. Terminal sessions live in the terminal plugin and use the shared process broker, PTY/tmux
runtime, replay tail, and WebSocket streams. The MCP server is a stdio child that calls the Node over
loopback using a task-scoped internal token; it never opens SQLite directly.

Task-scoped child processes can use only task-addressed routes and cannot read provider credentials or
administer the Node. Service-scoped internal calls are reserved for Node-owned orchestration.

## Documentation map

- [features.md](./features.md) — user-visible surfaces.
- [frontend.md](./frontend.md), [state.md](./state.md), [panes.md](./panes.md) — renderer behavior.
- [authentication.md](./authentication.md), [security.md](./security.md) — trust boundaries.
- [api-reference.md](./api-reference.md), [data-layer.md](./data-layer.md), [caching.md](./caching.md) — Node contracts.
- [plugins.md](./plugins.md), [agent-tools.md](./agent-tools.md) — extension and tool boundaries.
- [electron.md](./electron.md), [local-development.md](./local-development.md) — runtime and development.
