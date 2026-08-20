# Architecture overview

acorn is a desktop client for one or more local Node services. The client owns presentation and
fleet membership. A Node owns the data and execution environment for the projects assigned to
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

The Node binds `127.0.0.1` over HTTPS with TLS 1.3, and only loopback unless an operator has recorded
an `advertiseHost` for it (`node.json`, or `ACORN_ADVERTISE_HOST`) — see
[node-distribution.md](./node-distribution.md). A Host header outside that allowlist is refused with
403 regardless. The endpoint the Node *reports* is always loopback, because the child processes it
spawns validate its certificate against an `IP:127.0.0.1` SAN. The port is ephemeral unless
`ACORN_PORT` is set or a remembered port in `node.json` is available. The Node serves no web assets. Electron's
`app://acorn` protocol serves the renderer and falls back to its bundled `index.html` for client-side
routes.

## Process ownership

The Node owns:

- core and plugin SQLite connections and migrations;
- workspaces, projects, tasks, worktrees, Git, files, and project configuration;
- PTYs, tmux sessions, child processes, managed agents, workflows, Docker, and Postgres access;
- provider integrations, encrypted secrets, mirrors, blob storage, audit, backup, and
  reconciliation;
- the one scheduler: all periodic work, whoever declared it (docs/schedules.md). No client owns a
  timer that fires work — a panel poll is "I am looking at this", a schedule is "do this whether or
  not anyone is";
- the HTTPS listener, authenticated WebSocket, stream/tunnel sockets, and shutdown drain.

Electron main owns:

- `BrowserWindow`, `WebContentsView`, dialogs, menus, navigation policy, and `safeStorage`;
- the renderer preload bridge and node connection broker;
- Node endpoint records, certificate pins, device-token custody, fleet membership, and service
  supervision.

Only serializable values cross a boundary. Product requests and streams use the broker and `/v2`;
the service protocol is reserved for lifecycle messages and narrow, task-addressed native
capabilities such as preview/browser operations.

## Package boundaries

`tools/arch/boundaries.test.ts` enforces the rules below over the import graph of every package in
`apps/`, `packages/`, `plugins/` and `tools/`. It exists because `"exports": { "./*": "./src/*" }` gives
the module system no encapsulation at all — any package can reach any file in any other — so the
boundaries have to be a test rather than a build error. Package kind comes from where a package lives,
never from its name.

Test files follow the same rules as production files unless a rule names an exception, and several
rules carry a **shrinking baseline**: a list of survivors that may only get shorter. Adding to one is a
decision someone has to write down.

**Graph shape.** No cycles. `packages/*` never imports `plugins/*` — the inversion that made
client-core cyclic, and one acyclicity alone does not catch, because a plugin whose only upstream is
`@acorn/protocol` closes no cycle. Apps never import each other.

**What a plugin may import.** The facade (`@acorn/plugin-api`), the wire types, another plugin's
`contract/`, and its own files. Nothing else in `packages/`. `contract/` is the one cross-plugin import
surface, and it may not re-export a package's internals even transitively — `contract/x.ts ->
shared/y.ts -> main/heavy.ts` would drag the implementation into every consumer. Types a contract needs
live in `contract/` or `shared/`.

**What an app may import.** A plugin's four public entrypoints (`node/`, `client/`, `main/index.ts`,
`contract/`) and no internal module, so a composition root cannot come to depend on something never
meant to be load-bearing. Tests are exempt.

**Test scaffolding stays out of production.** No production file imports any package's `testkit/`,
which is how a temp-directory SQLite factory ends up shipped. Deep imports past
`@acorn/plugin-api/testkit` are a shrinking baseline; migrate a test as you touch it, and widen the
testkit rather than adding a root.

**The node stays bootable.** Nothing outside `apps/desktop` statically imports Electron *values*. A
type-only import is erased and a lazy `createRequire(import.meta.url)('electron')` only resolves when
called; a static value import fails Node's linker before a line runs. `export … from 'electron'` counts,
and is the likelier form on a barrel.
`apps/node/test/integration/mainBarrelLoad.test.ts` is the durable check — it loads every plugin's main
barrel in plain Node — and the arch rule is the fast first line that also catches an *unused* static
import, which esbuild elides before Node ever sees it.

**The client stays portable.** `window.acorn` is read only inside `packages/client-core/src/platform/`.
The global is read rather than imported, so this is a source scan rather than a graph edge. Tests are
permanently exempt: stubbing `globalThis.window` is how the platform implementation gets exercised.

**Core seams are not reachable around.** The raw identity store is confined to `packages/node-core`
plus the two composition roots that construct it — the node's identity used to be *written* by
`plugins/github`, which made "who is the user" a side effect of connecting one provider. The plugin
trust and bundle stores are confined to `apps/desktop`, because trust binds to a hash the main process
computed and the renderer must stay inert. A plugin's production code never imports core's `db` module.
Every child process goes through the process broker, with a written list of considered exceptions — a
PTY, a long-lived agent driver, a `docker logs -f` stream and a pg client are none of the things the
broker models.

**`@acorn/protocol` owns no plugin's wire surface.** Every plugin route lives under `/v2/p/<plugin>/`
and core's under `/v2/core/`, so one literal catches a route builder protocol does not own. api.ts was
701 lines of nine plugins' route builders, which meant no plugin could define its own wire surface
without editing core. Plugin-named *type* modules that remain are an explicit list with a stated reason
each.

**The facade stays boring.** `@acorn/plugin-api` is re-exports only: no declarations, no plain imports.
Only the two UI barrels may re-export a `.tsx` module, so every other entrypoint stays loadable from a
plugin's node-environment test suite. `ui/` may import only pure or presentation modules, from an
allowlist of destinations rather than a denylist of data modules.

**Two spellings that must not drift.** `PLUGIN_ROUTE_SEGMENT` is declared in client-core and re-spelled
as a literal in `node-core/main/pluginManifest.ts`, because the client is downstream of the node and
cannot share the constant. The test turns that edit into a failure rather than a route the device
refuses after the node accepted it.

**Two renderer traps.** A contribution's props may not declare `ref` as data anywhere in
`client-core/src/registries/`: Solid rewrites `ref={value}` on a component into a callback, so the panel
reads `props.ref.displayId` as `undefined`, and TypeScript cannot see it because `ref` lives on
`IntrinsicAttributes`. And a CSS class defined in a plugin's stylesheet may not be worn by markup
outside that plugin, or a pane silently loses its styling when an unrelated plugin is switched off.

## Node API and client flow

The Node exposes one Hono application:

- `/v2/node` and `/v2/pair` are the two pre-auth pairing routes;
- `/v2/core/*` contains core-owned workspaces, projects, tasks, worktrees, integrations, settings,
  security, backup, audit, schedule, agent-tool, and task-context routes;
- `/v2/p/<plugin>/*` contains plugin-contributed routes. A built-in's router is mounted when the app
  is built; a loaded plugin's fetch handler is resolved from the route registry per REQUEST, so a
  plugin reloaded in place serves its new handler without a restart (docs/plugins.md § The dev loop);
- `/v2/events` is the authenticated WebSocket for invalidation events, PTY/process streams, Docker
  streams, workflow notices, agent events, and preview tunnels.

Who owns which contract: `packages/protocol` holds what is genuinely shared — the error envelope,
node identity, pairing, the broker and service protocols, the WS envelope, and the core resource
types (workspaces, tasks, devices, audit, backup). A plugin owns its own wire surface: route
builders, request/response types, and query keys live in that plugin's `shared/`, or in its
`contract/` when another plugin reads them (`plugins/docker/src/shared/model.ts` is the model to
copy). Two boundary rules in `tools/arch/boundaries.test.ts` enforce it — protocol may declare no
`/v2/p/` route at all, and the set of protocol modules named for a plugin is an enumerated,
shrinking list. This is what lets a plugin define its wire contract without editing core, which is
the precondition for third-party plugins.

`packages/dashboards-core` is the second package both runtimes import, and the only other one. It
holds the pure dashboard pipeline — the panel model and its codec, shaping, cross-source mapping,
layout, chart and cell arithmetic — with no Solid, no registries and no fetch, and it exists because
the node's measure sampler must compute a panel's number with the SAME functions the renderer draws
it with (`docs/schedules.md`). Two implementations of "this panel's measure" would agree until the
day one changed, and the point of recording history is that a stored number means what the number on
screen means. Client-core re-exports every module it moved, so the components there still say
`./model`; the node imports it directly. Like protocol it declares no DOM and no node types, which
is what keeps the standalone node's graph clean.

The renderer reaches the host through one seam, `packages/client-core/src/platform/`, which groups
what a host provides — node transport, fleet membership, plugin custody, and the native extras — into
separate nullable capabilities. The thin client in `packages/client-core` calls the transport group;
nothing else in the client may read the injected `window.acorn` global, and `boundaries.test.ts` fails
any file outside the seam that does. The Electron preload is the only implementation today; a web
client implements the transport group and omits the desktop extras.
Electron main supplies the Node endpoint, pinned HTTPS agent, and bearer token. The renderer never
holds a token or certificate and cannot open a direct network connection under the app CSP.

Every response has an `X-Request-Id`. Errors use the single envelope
`{ error: { code, message, requestId, retryable, details? } }`. Mutations may use
`Idempotency-Key`; session creation, agent turns, and request resolution require one.

### Wire validation

**Zod at every mutation boundary.** A route that accepts a body parses it with a Zod schema and
returns 400 on failure — `safeParse` against a module-level schema, as
`server/routes/worktree.ts` does. Reads are not validated: the client is TypeScript compiled against
the same types, and a response schema would only restate the type.

The rule exists because the alternative was drift. Roughly ten route files parsed with Zod while
others hand-rolled `typeof` chains, and the chains were where the bugs hid: a positive-integer check
spread over three conjuncts, a non-empty string check that only tested `typeof`. Neither is visible
to `tsc`, because the body starts as `unknown`.

Deliberately NOT done: response schemas, full request/response codegen, or an OpenAPI pipeline.
Every consumer is TypeScript in this repo; Zod at the boundary is as far as this needs to go.

The exceptions are all one boundary, and it is the boundary that clause does not cover: a **loaded
plugin's** answer is not this repo's TypeScript, and the host renders it under its own chrome. Those
reads get real schemas in `@acorn/protocol` and are parsed on arrival — the manifest itself, agent
context options and snapshots, batch reference resolutions, and now **collections**
([dashboards.md](./dashboards.md)), whose rows are drawn as the host's own table beside another
plugin's. Each parses all-or-nothing rather than sanitising field by field, because a half-accepted
answer renders as complete and is not. Adding to this list means naming the same argument: untrusted
wire, host-drawn.

## Product model

```text
Workspace: named group of projects
  └─ Task: one project, optional branch/worktree and linked external item
       ├─ ordered/resizable panes
       └─ per-task terminal and managed-agent sessions
```

Workspaces are machine-local groups. A project belongs to one workspace. A task is always owned
by one Node and one project. Task origins are `github-pr`, `linear`, `rollbar`, or `local`.

The renderer shell is contribution-driven. Plugins register task panes, rail sources, command-palette
rows, settings pages, slots, context sections, attention items, and node statistics. The shipped
feature packages are GitHub, terminal, agents, editor, changes, notes, memory, context, workflows,
Docker, preview, onboarding, and the built-in
Claude, Codex, and Aider profiles registered by `plugins/agents`.

Five packages ship as loaded plugins instead, present in neither compiled-plugin list. Rollbar was
the first: its node provider is installed from disk, its rail rows are host-drawn descriptors, and its
detail UI is a sandboxed frame. Model providers — the OpenAI and Anthropic connections and text
adapters — is the minimal shape: a node bundle and a manifest, no client bundle at all, so there is
nothing on the device to trust. Linear is the widest: a pane frame, a reference-panel frame that
github's PR detail renders, a descriptor rail source with host-owned task promotion, and declarative
`linear.app` URL recognisers. HTTP was the first to exercise plugin-owned tables and migrations end
to end, and database moved onto the host-owned document surface (`docs/plugins.md § Document
surfaces`), which is what proved that contract. The desktop ships every built package as app resources and the service
reconciles them into the writable data root before plugin discovery; app-owned copies update with the
app, while owner-installed overrides and uninstall tombstones win. A standalone Node has no app
resources to reconcile from, so that step does nothing unless a developer names a directory to reconcile
from — see [node-distribution.md](./node-distribution.md) § Plugins.

Plugins come in two tiers. Those feature packages are **compiled in**: they ship in the binary, run
in the shell's own realm, and are trusted like the rest of the app. A Node can also **load** a
plugin from disk — installed through an owner-authenticated route, distributed to each paired
device by the Node that owns it, and rendered in a sandboxed frame or as host-drawn descriptors.
The two tiers are permanent and the line between them is what a contribution needs: anything
expressible as data plus async messages can be sandboxed, while PTY stream ownership, inline
agent-tool renderers, and components embedded in another surface's tree need the shared realm and
stay first-party. [plugins.md](./plugins.md) describes both tiers as they work today,
[first-party-plugins.md](./first-party-plugins.md) says which shipped plugins are in the first tier
because they must be, and [extensibility.md](./extensibility.md) is why the split exists at all.

## Data ownership

The Node separates disposable provider projections from application-owned state. GitHub, Linear, and
Rollbar data is cached locally and revalidated on demand. Workspaces, tasks, notes, memories, agent
sessions, workflow state, integrations, preferences, project configuration, saved queries, devices,
and audit records are local source-of-truth data.

Core owns the cross-feature workspace/task model, device and idempotency state, integrations, generic
external-item projections, node preferences, config-trust acknowledgements, and audit records. A
table-owning plugin owns its own SQLite file and migration chain. Plugins do not query one another's
databases or use cross-file foreign keys; cross-plugin references are IDs resolved through typed
CoreServices or capability contracts.

The same line holds in the UI. A plugin's surface can be extended by another plugin only where its own
manifest declares an extension point, and what crosses is a host-validated descriptor fetched from the
contributor's own route — never a component, a callback, or DOM access into another realm
([plugins.md](./plugins.md) § Cooperative extension points). A plugin may also offer to draw one of
core's designated surfaces, which the user arbitrates in settings and which falls back to core's own
implementation on absence or failure. Neither is reachable from a plugin frame: both registries are
populated host-side from manifests the device read, and the frame bridge gained no message kind.

The shared on-disk blob cache stores immutable patch bodies, file bodies, attachments, and artifacts
by content hash. Worktrees and blobs are not included in backups. Backup snapshots core and plugin
databases with credentials and device rows scrubbed; restore is a manual operation into a fresh data
root.

## Client state and fleet behavior

The client has one disposable query cache and IndexedDB persister per Node. It also persists fleet
membership, endpoint pins, device tokens, device preferences, drafts, and selection state. Pane
layouts and the other compositions belong to the Node they describe, not the device (docs/state.md).
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
- [frontend.md](./frontend.md), [state.md](./state.md), [panes.md](./panes.md),
  [dashboards.md](./dashboards.md) — renderer behavior.
- [authentication.md](./authentication.md), [security.md](./security.md) — trust boundaries.
- [api-reference.md](./api-reference.md), [data-layer.md](./data-layer.md), [caching.md](./caching.md) — Node contracts.
- [extensibility.md](./extensibility.md) — **why** the plugin system is shaped the way it is, the
  decisions behind it, and where it is going. Read before changing a plugin seam.
- [plugins.md](./plugins.md), [agent-tools.md](./agent-tools.md) — extension and tool boundaries.
- [plugin-authoring.md](./plugin-authoring.md) — the no-build-step authoring contract for a loaded
  plugin written by hand, with a worked example.
- [first-party-plugins.md](./first-party-plugins.md) — every shipped plugin, and which of them are
  first-party because they must be rather than because they were written first.
- [third-party/](./third-party/) — review findings from moving Rollbar out of the binary and onto
  the loaded-plugin path.
- [electron.md](./electron.md), [local-development.md](./local-development.md) — runtime and development.
