# Architecture overview

This page is the map of acorn's runtimes: what runs where, what each process owns, and which doc owns
each contract. Read it first, then follow the links to the part you're about to change.

acorn has desktop and terminal clients that connect to one or more Nodes, local or remote. Each Node
owns its data and its execution environment. Clients own presentation and fleet membership. Nodes
don't share a database or take part in cross-Node transactions.

Core owns runtime lifecycle, authentication, transport, storage access, and plugin registration.
Plugins provide product features through declared contributions. They listen to events and call
capabilities through the plugin API instead of importing core code.

The desktop renderer and the terminal client share `@acorn/client-core`, the layouts, and the UI kit,
so one UI implementation supports both. Desktop-only frames, webviews, and platform operations need a
host requirement or a terminal fallback. The browser client is a [design proposal](./future/remote.md).

## Runtime topology

```text
Desktop app (Tauri)
  renderer: SolidJS shell, panes, query cache, layouts, drafts
  Rust shell: app:// scheme, window, child webviews, dialogs, the data key
       │ one loopback WebSocket
       ▼
desktop helper (Node): the process the Rust shell spawns and supervises
  @acorn/custody: connection broker, fleet, tokens, plugin custody, supervision
       │ pinned HTTPS + device bearer, one WebSocket per Node
       ├──────────────► bundled local Node
       └──────────────► paired Node

Node
  Hono /v1 server + /v1/events
  core.sqlite + plugin SQLite files + blobs
  Git, worktrees, PTYs, agents, workflows, Docker, provider clients
```

```text
acorn (the Node the repo pins, no flag)
  its own tree, Yoga in wasm and a cell buffer: the same kit, layouts and panes, drawn in cells
  @acorn/custody in-process: broker, fleet, tokens, plugin custody
       │ pinned HTTPS + device bearer, one WebSocket per Node
       └──────────────► the node for this machine's data root, attached or started
```

The desktop helper starts the built `apps/node` artifact with `process.execPath`, the Node runtime
the bundle ships. The Node reports its bound endpoint and certificate fingerprint through the service
protocol. The helper supervises the local Node and restarts it with bounded backoff. A standalone Node
uses the same service graph.

The Node listens over HTTPS with TLS 1.3 on `127.0.0.1`. It binds only loopback unless an operator
records an `advertiseHost` in `node.json` or `ACORN_ADVERTISE_HOST`, as
[node distribution](./node-distribution.md) describes. A Host header outside that allowlist gets 403.
The endpoint the Node reports is always loopback, because its child processes validate its
certificate against an `IP:127.0.0.1` SAN. The port is ephemeral unless `ACORN_PORT` is set or the
port remembered in `node.json` is free.

The Node serves no web assets. The shell's `app://acorn` scheme serves the renderer and falls back
to its bundled `index.html` for client-side routes.

## Process ownership

| Process | Owns |
| --- | --- |
| Node | Core and plugin SQLite connections and migrations. Workspaces, projects, tasks, worktrees, Git, files, and project configuration. PTYs, tmux sessions, child processes, managed agents, workflows, Docker, and Postgres access. Provider integrations, encrypted secrets, mirrors, blobs, audit, backup, and reconciliation. The HTTPS listener, the WebSocket, stream and tunnel sockets, and the shutdown drain. |
| Desktop shell | The window, child webviews, dialogs, menus, navigation policy, and the data key in the OS keychain. The injected renderer bridge and the helper behind it. Node endpoint records, certificate pins, device tokens, fleet membership, and service supervision. |
| Terminal client | What the shell and helper own, in one process: the screen, endpoint records and pins, device tokens, plugin custody, and supervision of a Node it started. |
| Headless CLI | Nothing persistent, except a local Node started with `node start --background`. |

The Node runs the one scheduler for all periodic work, whoever declared it. No client owns a timer
that fires work. A panel poll says "I'm looking at this", and a schedule says "do this whether or
not anyone is". [Schedules](./schedules.md) covers it.

The desktop's three processes have one folder each: `apps/desktop/src/client/` is the renderer,
`apps/desktop/src/shell/` is the Tauri side, and `apps/desktop/src/helper/` is the Node process Rust
supervises. The terminal client holds the same split as a module boundary. An architecture rule
refuses a custody import from any `apps/tui` module that draws cells. It has no window, webview, or
keychain, so those affordances are absent through the platform seam. [Terminal client](./tui.md)
covers it.

The headless CLI enters through the same `acorn` launcher when a subcommand is present. It reuses
`@acorn/custody` for fleet membership, tokens, pins, and the broker, then reads one Node over `/v1`.
Ordinary commands attach without starting a Node. [CLI](./cli.md) covers it.

Only serializable values cross a process boundary. Product requests and streams use the broker and
`/v1`. The service protocol carries lifecycle messages only.

## Contracts and their owners

| Contract | Owner |
| --- | --- |
| What a package may import and publish | [Package boundaries](./architecture/packages.md) |
| Route families, the platform seam, and wire validation | [Node API and client flow](./architecture/node-api.md) |
| Every route, error, and transport detail | [API reference](./api-reference.md) |
| File and folder names | [Conventions](./conventions.md) |
| Which state lives on the Node and which on the device | [State ownership](./state-ownership.md) |
| Loaded plugin activation, `active` and `installed`, and trust | [Plugin activation](./plugins/activation.md) |
| Remote trees and mounted bridge ownership | [Descriptors](./plugins/descriptors.md) |

<a id="package-boundaries"></a>
<a id="node-api-and-client-flow"></a>
<a id="wire-validation"></a>
<a id="node-provided-plugin-ui"></a>

Package boundaries moved to [package boundaries](./architecture/packages.md). The Node API, client
flow, and wire validation moved to [Node API and client flow](./architecture/node-api.md).

## Product model

```text
Workspace: named group of projects
  └─ Task: one project, optional branch/worktree and linked external item
       ├─ ordered/resizable panes
       └─ per-task terminal and managed-agent sessions
```

Workspaces are machine-local groups, and a project belongs to one. A task is always owned by one Node
and one project. A task's origin is the id of the source that made it, which the owning plugin
declares, or `local` when core made it. The glyph a row is drawn with comes from the source's own
`origins` map. A task whose plugin is off falls back to local chrome with its origin as the tooltip.
[Workspaces and tasks](./workspaces-and-tasks.md) owns the model.

The renderer shell is driven by contributions. Plugins register task panes, rail sources, palette
rows, settings pages, slots, context sections, attention sources, and Node statistics.

Plugins come in two tiers:

- **Compiled in.** They ship in the binary, run in the shell's own realm, and are trusted like the rest
  of the app: agents, browser, changes, context, Docker, editor, GitHub, memory, notes, onboarding,
  preview, terminal, and workflows. Agents registers the built-in Claude, Codex, and Aider profiles.
- **Loaded.** A Node loads them from disk, installed through an owner-authenticated route and
  distributed to each paired device. They draw as host-drawn descriptors, as a tree of host components
  sent from a Web Worker, or in a sandboxed frame. The app bundles agent-cost, database, HTTP, Linear,
  model providers, Rollbar, and Sentry telemetry as loaded plugins. A device can also hold a
  client-only loaded plugin, which wins over a Node's offer of the same ID.

The desktop ships every bundled package as an app resource, and the service copies them into the data
root before plugin discovery. Owner-installed overrides and uninstall markers win over the app's
copies. A standalone Node has no app resources, so it skips that step unless a developer names a
directory.

Anything expressible as data plus async messages can be sandboxed. PTY stream ownership, and
components the shell renders where it hasn't opened an extension point, need the shared realm and
stay first-party. [Plugins](./plugins.md) describes both tiers. [First-party plugins](./first-party-plugins.md)
says which plugins must be compiled in, and [extensibility](./extensibility.md) says why the split
exists.

## Data ownership

The Node separates disposable provider projections from data it owns. GitHub, Linear, and Rollbar data
is cached locally and revalidated on demand. Workspaces, tasks, notes, memories, agent sessions,
workflow state, integrations, preferences, project configuration, saved queries, devices, and audit
records are local source-of-truth data.

Core owns the workspace and task model, device and idempotency state, integrations, generic
external-item projections, Node preferences, config-trust acknowledgements, and audit records. A
plugin with tables owns its own SQLite file and migration chain. Plugins don't query each other's
databases or use foreign keys across files. They resolve references by ID through typed core services
or capability contracts.

The same line holds in the UI. A plugin's surface can be extended by another plugin only where its
manifest declares an extension point. What crosses is a descriptor the host validates, fetched from
the contributor's own route, never a component, a callback, or DOM access. A plugin may also offer to
draw one of core's designated surfaces. The user picks in settings, and core's own version takes over
on absence or failure. A plugin frame can reach neither. See [plugins](./plugins.md).

The blob cache stores immutable patch bodies, file bodies, attachments, and artifacts by content
hash. Backups snapshot core and plugin databases with credentials and device rows removed, and leave
out worktrees and blobs. Restore is a manual operation into a fresh data root.

## Client state and fleet behavior

The client keeps one disposable query cache per Node, renders every Node-backed read with its
freshness, and fans aggregate surfaces out across Nodes. Partial results are a banner, never a failed
page. [Client state and fleet behavior](./architecture/fleet.md) owns the rules.

## The three parties

A client coordinates across Nodes, a Node owns its data, and an optional control plane only finds and
vouches for Nodes. acorn ships the two seams a control plane uses, enrollment and Node providers, but
no control plane. [The three parties](./architecture/control-plane.md) states what a control plane may
hold.

## Agent execution

Managed agent sessions live in the agents plugin and store normalized events in a durable per-session
sequence. Terminal sessions live in the terminal plugin and use the shared process broker, PTY and
tmux runtime, replay tail, and WebSocket streams. The MCP server is a stdio child that calls the Node
over loopback with a task-scoped internal token, and never opens SQLite directly.

Task-scoped child processes can use only task-addressed routes. They can't read provider credentials
or administer the Node. Service-scoped internal calls are reserved for Node-owned orchestration.

## Read next

[Documentation](./README.md) lists every doc. Read [features](./features.md) next, so the machinery
has something to hang on. Then read [frontend](./frontend.md) or [API reference](./api-reference.md),
whichever side you're changing, and [conventions](./conventions.md) for where a new file goes. If your
first task is a plugin, read the [plugin map](./plugin-map.md) instead of the frontend or API page.
