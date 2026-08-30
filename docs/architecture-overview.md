# Architecture overview

acorn is a desktop client for one or more local Node services. The client owns presentation and
fleet membership. A Node owns the data and execution environment for the projects assigned to
it. There is no shared database or cross-Node transaction.

## Runtime topology

```text
Desktop app (Tauri)
  renderer: SolidJS shell, panes, query cache, layouts, drafts
  Rust shell: app:// scheme, window, child webviews, dialogs, the data key
       │ one loopback WebSocket
       ▼
desktop helper (Node): connection broker, fleet, tokens, plugin custody, supervision
       │ pinned HTTPS + device bearer, one WebSocket per Node
       ├──────────────► bundled local Node
       └──────────────► paired Node

Node
  Hono /v2 server + /v2/events
  core.sqlite + plugin SQLite files + blobs
  Git, worktrees, PTYs, agents, workflows, Docker, provider clients
```

The desktop helper starts the built `apps/node` artifact with `process.execPath`, which is the Node
runtime the bundle ships. The Node reports its bound endpoint and certificate fingerprint through the
service protocol. The local Node is supervised and restarted with bounded backoff; a standalone Node
uses the same service graph.

The Node binds `127.0.0.1` over HTTPS with TLS 1.3, and only loopback unless an operator has recorded
an `advertiseHost` for it (`node.json`, or `ACORN_ADVERTISE_HOST`). For more information, see
[node distribution](./node-distribution.md). A Host header outside that allowlist is refused with
403 regardless. The endpoint the Node reports is always loopback, because the child processes it
spawns validate its certificate against an `IP:127.0.0.1` SAN. The port is ephemeral unless
`ACORN_PORT` is set or a remembered port in `node.json` is available. The Node serves no web assets. The
shell's `app://acorn` scheme serves the renderer and falls back to its bundled `index.html` for
client-side routes.

## Process ownership

The Node owns:

- Core and plugin SQLite connections and migrations.
- Workspaces, projects, tasks, worktrees, Git, files, and project configuration.
- PTYs, tmux sessions, child processes, managed agents, workflows, Docker, and Postgres access.
- Provider integrations, encrypted secrets, mirrors, blob storage, audit, backup, and reconciliation.
- The one scheduler, covering all periodic work whoever declared it. See
  [the schedules doc](./schedules.md). No client owns a timer that fires work. A panel poll says "I am
  looking at this"; a schedule says "do this whether or not anyone is".
- The HTTPS listener, authenticated WebSocket, stream and tunnel sockets, and shutdown drain.

The desktop shell owns:

- The window, child webviews, dialogs, menus, navigation policy, and the data key in the OS keychain.
- The injected renderer bridge, and the helper process behind it.
- Node endpoint records, certificate pins, device-token custody, fleet membership, and service
  supervision.

Only serializable values cross a boundary. Product requests and streams use the broker and `/v2`.
The service protocol is reserved for lifecycle messages.

## Package boundaries

`tools/arch/boundaries.test.ts` enforces the rules below over the import graph of every package in
`apps/`, `packages/`, `plugins/`, and `tools/`. Package kind comes from where a package lives, never
from its name.

The plugin packages are the exception to "the boundary is a test": each one declares an `exports` map
naming at most six subpaths, so a deep import into a plugin is a `tsc` error at the import site
rather than a boundary-test failure somewhere else in the repo.

`@acorn/protocol` is closed too, and it closed differently: it has no entrypoint to funnel through, so
its map enumerates its 40 modules one per line. That buys two things over the wildcard. A test file is
not importable from another package, and a new module is public only when someone adds the line, which
is the decision the map exists to record.

The other four library packages, `client-core`, `node-core`, `dashboards-core`, and `desktop-helper`,
still export `"./*": "./src/*"`, which gives the module system no encapsulation, and their boundaries
stay tests. Closing them is a bigger job than closing the plugins was, because every production import
into a plugin already went through an entrypoint and the same is not true one level up.

**The UI kit is closed as well**, and by a third mechanism again: by type. Every component a plugin
may draw with is one row in `packages/client-core/src/ui/kit/support.ts`, a node's props are role
tokens rather than DOM attributes, and a type-level test refuses `class`, `className` and `style` on
any of them ([ui design](./ui-design.md) § The closed kit). Two arch rules hold the rest — no plugin
ships a stylesheet, and no plugin mounts a Solid root of its own.

Test files follow the same rules as production files unless a rule names an exception, and several
rules carry a **shrinking baseline**: a list of survivors that may only get shorter. Adding to one is a
decision someone has to write down.

**Graph shape.** No cycles. `packages/*` never imports `plugins/*`. That inversion made client-core
cyclic, and acyclicity alone does not catch it, because a plugin whose only upstream is
`@acorn/protocol` closes no cycle. Apps never import each other.

**What a plugin may import.** The facade (`@acorn/plugin-api`), the wire types, another plugin's
`contract/`, and its own files. Nothing else in `packages/`. `contract/` is the one cross-plugin import
surface, and it may not re-export a package's internals even transitively. `contract/x.ts ->
shared/y.ts -> main/heavy.ts` would drag the implementation into every consumer. Types a contract needs
live in `contract/` or `shared/`.

**What an app may import.** A plugin's public subpaths, and no internal module, so a composition root
cannot come to depend on something never meant to be load-bearing. There are six kinds, and a plugin
declares only the ones it has:

| Subpath | For |
| --- | --- |
| `./node/index.ts` | the Node activation entrypoint |
| `./client/index.ts` | the client activation entrypoint |
| `./main/index.ts` | the shell-side half, where one exists |
| `./contract/*` | the cross-plugin surface, open as a directory because that is what a contract is |
| `./testkit` | what a node-side test outside this package needs |
| `./testkit/client` | the same for a client-side test, split so DOM types stay out of a node program |

Tests are no longer exempt, which is the change: 37 deep specifiers across 15 files under `apps/` now
go through a `testkit` instead of reaching into a plugin's internals, and each testkit file
names the tests it serves so an export can be traced to the reason it exists. Two plugins,
`linear` and `rollbar`, also declare `./server/index.ts`, because a `vi.mock` has to name the module
the code under test imports and both plugins' routes import their own `../index` relatively. The
arch test holds that list at two.

What the compiler cannot see is a map going back to `"./*": "./src/*"`, which would reopen every path
and break no build, so `tools/arch/boundaries.test.ts` checks the maps themselves: the subpaths are
from the set above, and every declared target exists. Protocol's map gets its own check, for the two
things a reader cannot verify by eye: no wildcard, no test file, and nothing pointing at a module that
has moved.

**Test scaffolding stays out of production.** No production file imports any package's `testkit/`,
which is how a temp-directory SQLite factory ends up shipped. That rule now covers fourteen plugin
testkits rather than one. Deep imports past `@acorn/plugin-api/testkit` are a shrinking baseline;
migrate a test as you touch it, and widen the testkit rather than adding a root. It was 167 across 48
files before the testkit existed, 147 once the first eleven moved, and 110 once the three roots the
facade already re-exported — `testkit/db.ts`, `testkit/auth.ts`, `server/db/index.ts` — were swapped for
it. Two whole roots left the list in that batch, which is the shape the exit condition wants: a root
disappears rather than shrinking. The exit is a plugin whose suite compiles against published surfaces
only, which is also the condition for moving that plugin out of the repository.

**The node stays bootable.** Nothing in the tree imports a shell binding it should not. Tauri's
`invoke` and its event API are confined to `apps/desktop/src/shell/`, the bridge the window injects.
Nothing imports `electron`, a flat ban that covers manifests too.
`apps/node/test/integration/mainBarrelLoad.test.ts` is the durable check: it loads every plugin's main
barrel in a plain Node process, which is the runtime that has to boot.

**The custody stack stays shell-free.** `@acorn/desktop-helper` is the broker, the fleet, the device
tokens, the plugin cache and trust store, the tunnels, and the supervised node service, composed by
its `main/index.ts`. It runs as its own process under the bundled Node, so it names no shell binding
and the encryption is injected rather than imported. See the shell process in
[the shell doc](./shell.md).

**The client stays portable.** `window.acorn` is read only inside `packages/client-core/src/platform/`.
The global is read rather than imported, so this is a source scan rather than a graph edge. Tests are
permanently exempt: stubbing `globalThis.window` is how the platform implementation gets exercised.

**Core seams are not reachable around.** The raw identity store is confined to `packages/node-core`
plus the two composition roots that construct it. The node's identity used to be written by
`plugins/github`, which made "who is the user" a side effect of connecting one provider. The plugin
trust and bundle stores are confined to `@acorn/desktop-helper`, because trust binds to a hash the
host process computed and the renderer must stay inert. A plugin's production code never imports
core's `db` module. Every child process goes through the process broker, with a written list of
considered exceptions: a PTY, a long-lived agent driver, a `docker logs -f` stream, and a pg client
are none of the things the broker models.

**`@acorn/protocol` owns no plugin's wire surface.** Every plugin route lives under `/v2/p/<plugin>/`
and core's under `/v2/core/`, so one literal catches a route builder protocol does not own. api.ts was
701 lines of nine plugins' route builders, so no plugin could define its own wire surface without
editing core. The plugin-named type modules that remain are an explicit list, each with a stated
reason.

**The facade stays boring.** `@acorn/plugin-api` is re-exports only: no declarations, no plain imports.
Only the two UI barrels may re-export a `.tsx` module, so every other entrypoint stays loadable from a
plugin's node-environment test suite. `ui/` may import only pure or presentation modules, from an
allowlist of destinations rather than a denylist of data modules.

**Two spellings that must not drift.** `PLUGIN_ROUTE_SEGMENT` is declared in client-core and re-spelled
as a literal in `node-core/main/pluginManifest.ts`, because the client is downstream of the node and
cannot share the constant. The test turns that edit into a failure rather than a route the device
refuses after the node accepted it.

**Two renderer traps.** A contribution's props may not declare `ref` as data anywhere in
`client-core/src/registries/`. Solid rewrites `ref={value}` on a component into a callback, so the
panel reads `props.ref.displayId` as `undefined`, and TypeScript cannot see it because `ref` lives on
`IntrinsicAttributes`. Second, a CSS class defined in a plugin's stylesheet may not be worn by markup
outside that plugin, or a pane silently loses its styling when an unrelated plugin is switched off.

## Node API and client flow

The Node exposes one Hono application:

- `/v2/node` and `/v2/pair` are the two pre-auth pairing routes.
- `/v2/core/*` contains core-owned workspaces, projects, tasks, worktrees, integrations, settings,
  security, backup, audit, schedule, agent-tool, and task-context routes.
- `/v2/p/<plugin>/*` contains plugin-contributed routes. A built-in's router is mounted when the app
  is built. A loaded plugin's fetch handler is resolved from the route registry per request, so a
  plugin reloaded in place serves its new handler without a restart. See the dev loop in
  [the plugins doc](./plugins.md).
- `/v2/events` is the authenticated WebSocket for invalidation events, PTY and process streams,
  Docker streams, workflow notices, agent events, and preview tunnels.

`packages/protocol` holds what is genuinely shared: the error envelope, node identity, pairing, the
broker and service protocols, the WebSocket envelope, and the core resource types (workspaces, tasks,
devices, audit, backup). A plugin owns its own wire surface. Route builders, request and response
types, and query keys live in that plugin's `shared/`, or in its `contract/` when another plugin
reads them. Copy `plugins/docker/src/shared/model.ts`. Two boundary rules in
`tools/arch/boundaries.test.ts` enforce it: protocol may declare no `/v2/p/` route, and the set of
protocol modules named for a plugin is an enumerated, shrinking list. That lets a plugin define its
wire contract without editing core, which is the precondition for third-party plugins.

`packages/dashboards-core` is the only other package both runtimes import. It holds the pure
dashboard pipeline: the panel model and its codec, shaping, cross-source mapping, layout, and chart
and cell arithmetic, with no Solid, no registries, and no fetch. It exists because the node's measure
sampler must compute a panel's number with the same functions the renderer draws it with. See
[the schedules doc](./schedules.md). Two implementations of "this panel's measure" would agree until
the day one changed, and the point of recording history is that a stored number means what the number
on screen means. Client-core re-exports every module it moved, so the components there still say
`./model`, and the node imports it directly. Like protocol it declares no DOM and no node types,
which keeps the standalone node's graph clean.

The renderer reaches the host through one seam, `packages/client-core/src/platform/`. It groups what
a host provides, namely node transport, fleet membership, plugin custody, and the native extras, into
separate nullable capabilities. The thin client in `packages/client-core` calls the transport group.
Nothing else in the client may read the injected `window.acorn` global, and `boundaries.test.ts`
fails any file outside the seam that does. The desktop bridge is the only implementation. A web
client would implement the transport group and omit the desktop extras.

The helper supplies the Node endpoint, pinned HTTPS agent, and bearer token. The renderer never
holds a token or certificate and cannot open a direct network connection under the app CSP.

Every response has an `X-Request-Id`. Errors use the single envelope
`{ error: { code, message, requestId, retryable, details? } }`. Mutations may use
`Idempotency-Key`; session creation, agent turns, and request resolution require one.

### Wire validation

**Zod at every mutation boundary.** A route that accepts a body parses it with a Zod schema and
returns 400 on failure, using `safeParse` against a module-level schema, as
`server/routes/worktree.ts` does. Reads are not validated, because the client is TypeScript compiled
against the same types and a response schema would restate the type.

The rule exists because the alternative was drift. Roughly ten route files parsed with Zod while
others hand-rolled `typeof` chains, and the chains were where the bugs hid: a positive-integer check
spread over three conjuncts, a non-empty string check that only tested `typeof`. Neither is visible
to `tsc`, because the body starts as `unknown`.

Writing it here was not enough. The 2026-08-27 architecture review found ten route files back on
casts, the worst of them passing a merge method straight to GitHub unchecked, so the rule is now an
arch test: a file that calls `c.req.json()` and contains no `safeParse` fails
`tools/arch/boundaries.test.ts`. The check is file-level, which is coarse on purpose. Matching each
`safeParse` to the read it belongs to would mean parsing the file, and the failure worth catching is
a route file with no schema in it at all. One allowlist entry survives, `plugins/agents`'s usage
routes, whose hand-written validators live in `shared/` so the settings form can run them too and
return per-field messages; the test names the reason and fails if that file stops reading a body.

Deliberately not done: response schemas, full request and response codegen, or an OpenAPI pipeline.
Every consumer is TypeScript in this repo, so Zod at the boundary is as far as this goes.

The exceptions are all one boundary, the one that clause does not cover. A loaded plugin's answer is
not this repo's TypeScript, and the host renders it under its own chrome. Those reads get real
schemas in `@acorn/protocol` and are parsed on arrival: the manifest itself, agent context options
and snapshots, batch reference resolutions, and collections, whose rows are drawn as the host's own
table beside another plugin's. See [the dashboards doc](./dashboards.md). Each parses
all-or-nothing rather than sanitising field by field, because a half-accepted answer renders as
complete and is not. Adding to this list means naming the same argument: untrusted wire, host-drawn.

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
rows, settings pages, slots, context-section slots, attention sources, and node statistics. The shipped
feature packages are GitHub, terminal, agents, editor, changes, notes, memory, context, workflows,
Docker, preview, onboarding, and the built-in Claude, Codex, and Aider profiles registered by
`plugins/agents`.

Five packages ship as loaded plugins instead, in neither compiled-plugin list. Rollbar was the first:
its node provider is installed from disk, its rail rows are host-drawn descriptors, and its detail UI
is a sandboxed frame. Model providers, the OpenAI and Anthropic connections and text adapters, is the
minimal shape: a node bundle and a manifest, no client bundle at all, so there is nothing on the
device to trust. Linear is the widest: a pane frame, a reference-panel frame that github's PR detail
renders, a descriptor rail source with host-owned task promotion, and declarative `linear.app` URL
recognisers. HTTP was the first to exercise plugin-owned tables and migrations end to end, and
database moved onto the host-owned document surface, which proved that contract. See document
surfaces in [the plugins doc](./plugins.md).

The desktop ships every built package as app resources, and the service reconciles them into the
writable data root before plugin discovery. App-owned copies update with the app, while
owner-installed overrides and uninstall tombstones win. A standalone Node has no app resources to
reconcile from, so that step does nothing unless a developer names a directory to reconcile from. See
the plugins section of [node distribution](./node-distribution.md).

Plugins come in two tiers. Those feature packages are **compiled in**: they ship in the binary, run
in the shell's own realm, and are trusted like the rest of the app. A Node can also **load** a plugin
from disk, installed through an owner-authenticated route, distributed to each paired device by the
Node that owns it, and drawn three ways: as host-drawn descriptors, as a tree of the host's own
components emitted from a Web Worker, or in a sandboxed frame for pixels the host cannot draw. The two
tiers are permanent, and the line between them is what a contribution needs. Anything expressible as
data plus async messages can be sandboxed, while PTY stream ownership and components the shell renders
inside its own tree at a place it has not opened as an extension point need the shared realm and stay
first-party.
[The plugins doc](./plugins.md) describes both tiers,
[first-party plugins](./first-party-plugins.md) says which shipped plugins are in the first tier
because they must be, and [extensibility](./extensibility.md) is why the split exists at all.

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

The same line holds in the UI. A plugin's surface can be extended by another plugin only where its
own manifest declares an extension point, and what crosses is a host-validated descriptor fetched
from the contributor's own route, never a component, a callback, or DOM access into another realm.
See cooperative extension points in [the plugins doc](./plugins.md). A plugin may also offer to draw
one of core's designated surfaces, which the user arbitrates in settings and which falls back to
core's own implementation on absence or failure. Neither is reachable from a plugin frame: both
registries are populated host-side from manifests the device read, and the frame bridge gained no
message kind.

The shared on-disk blob cache stores immutable patch bodies, file bodies, attachments, and artifacts
by content hash. Worktrees and blobs are not included in backups. Backup snapshots core and plugin
databases with credentials and device rows scrubbed; restore is a manual operation into a fresh data
root.

## Client state and fleet behavior

The client has one disposable query cache and IndexedDB persister per Node. It also persists fleet
membership, endpoint pins, device tokens, device preferences, drafts, and selection state. Pane
layouts and the other compositions belong to the Node they describe, not the device. See
[the state doc](./state.md).
Every Node-backed query is rendered with `live`, `refreshing`, `stale`, `offline`, `disabled`, or
`error` status. Cached reads remain visible when a Node is offline; mutations fail fast and retain
the user's text as a draft. There is no automatic mutation queue.

A paired Node's own connection has a smaller vocabulary. `NodeConnectionState`
(`packages/protocol/src/broker.ts`) is `online`, `degraded`, `offline`, `incompatible`, or `revoked`,
and nothing else. A certificate fingerprint mismatch is not a sixth state. It surfaces as `offline`
with an `identity_mismatch` error, because it is a reason the Node is unreachable rather than a
steady state the UI needs its own row for. `incompatible` is decided from the protocol major the
probe reports, before pairing completes, so a client refuses to pair with an incompatible Node rather
than pairing and then discovering it cannot talk to it. See versioning in
[the API reference](./api-reference.md).

Aggregate surfaces fan out requests per Node with bounded timeouts, merge successful results, and
show partial availability with a Node label. A mutation always targets the Node that owns its
resource. Node IDs are part of cache and persisted-state scope, so identical IDs on different Nodes
cannot collide.

The Fleet source and the node switcher appear only once more than one Node is paired
(`SourceContribution.when`). With a single bundled local Node the rail never mentions Nodes, so
first-run stays a one-Node product. When a Node stops answering, its card in the Fleet view keeps
rendering from that Node's own query cache rather than blanking. `createFleetQuery` falls back to
whatever that Node's `QueryClient` last held, so a Node that answered once and then went quiet reads
as a stale row rather than a failure. The banner that says a Node has never answered is reserved for
a Node whose cache is empty. Conflating the two would make an offline Node look unreachable and a
never-reachable Node look stale.

## The three parties, and what a control plane may hold

There are two parties today and an optional third. The **client** coordinates across the Nodes it can
see. A **Node** owns its data and drives its own work. A **control plane** holds metadata about Nodes
and vouches for them, and it is never in the data path.

The rule that keeps the third party honest: **a control plane stores what it takes to find a Node and
vouch for it, and nothing about what the Node is doing.** Node inventory, endpoints, fingerprints,
enrollment records, provider handles, accounts, billing: yes. Tasks, repository contents, agent
transcripts, run history: no. Any design that syncs task-shaped rows to a service fails this by
inspection.

Holding that line is what keeps three things true. The control plane stays replaceable, because
nothing depends on it having seen your work. The trust story stays one sentence
([the security doc](./security.md) § The control plane). And every `/v2` route and the WebSocket are
untouched, so a Node with no account and no control plane is the fully usable default rather than a
degraded mode.

Two seams connect the third party, and nothing else does. A Node can enroll with a control plane at
first boot, which is [the enrollment doc](./node-enrollment.md). A plugin can contribute a node
provider, which puts Nodes in the fleet ([the plugins doc](./plugins.md) § Node providers). Both are
optional, both are inert when unconfigured, and there is no `nodes` table in core: the provider
answers, the client merges, the desktop host stores what it adopts, and `node.json` gains one optional
record.

## Agent execution

Managed agent sessions live in the agents plugin and persist normalized events in a durable per-session
sequence. Terminal sessions live in the terminal plugin and use the shared process broker, PTY and
tmux runtime, replay tail, and WebSocket streams. The MCP server is a stdio child that calls the Node
over loopback using a task-scoped internal token. It never opens SQLite directly.

Task-scoped child processes can use only task-addressed routes and cannot read provider credentials or
administer the Node. Service-scoped internal calls are reserved for Node-owned orchestration.

## Documentation map

- User-visible surfaces: [features](./features.md).
- Renderer behavior: [frontend](./frontend.md), [state](./state.md), [panes](./panes.md), and
  [dashboards](./dashboards.md).
- Trust boundaries: [authentication](./authentication.md) and [security](./security.md).
- How a provisioned Node introduces itself to a control plane, and the versioned protocol it speaks:
  [node enrollment](./node-enrollment.md).
- Node contracts: [API reference](./api-reference.md), [data layer](./data-layer.md), and
  [caching](./caching.md).
- Why the plugin system is shaped this way, the decisions behind it, and where it is going:
  [extensibility](./extensibility.md). Read it before changing a plugin seam.
- Extension and tool boundaries: [plugins](./plugins.md) and [agent tools](./agent-tools.md).
- The one-page orientation map over that reference, naming every plugin surface with two worked
  examples: [how a plugin fits together](./plugin-map.md).
- The no-build-step authoring contract for a hand-written loaded plugin, with a worked example:
  [plugin authoring](./plugin-authoring.md).
- Every shipped plugin, and which are first-party because they must be rather than because they were
  written first: [first-party plugins](./first-party-plugins.md).
- Review findings from moving Rollbar out of the binary onto the loaded-plugin path:
  [third-party](./third-party/).
- Plugin UI is host-owned layouts, a closed component kit, remote component trees, five extension
  kinds and host-owned keyboard navigation, all shipped 2026-08-30. The kit is in
  [ui design](./ui-design.md) § The closed kit, the layouts in [panes](./panes.md) § Layout model, the
  keyboard in [command palette and shortcuts](./command-palette-and-shortcuts.md), the five kinds in
  [plugins](./plugins.md) § Cooperative extension points, and the two render paths in
  [plugins](./plugins.md) § Loaded plugins: the client half.
- Runtime and development: [shell](./shell.md) and [local development](./local-development.md).
