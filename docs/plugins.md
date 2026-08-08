# Plugins

Plugins are first-party packages compiled into acorn. A plugin can contribute Node behavior, client
behavior, or both. There is no runtime installation system: a plugin exists only when its composition
root registers it.

## Package shape

```text
plugins/<name>/
  src/
    node/       NodePlugin entry, schema, and Node-owned behavior
    server/     Hono route handlers and provider logic
    main/       Electron-free runtime engines and adapters
    client/     SolidJS panes, sources, settings, and contributions
    contract/   narrow cross-plugin types, capability IDs, and provider contracts
    shared/     types/logic shared by this plugin's runtimes
```

Not every plugin has every directory. The built-in Claude, Codex, and Aider profiles are registered
by `plugins/agents`; there are no separate profile packages. Onboarding is a client overlay with
core setup support. Linear and Rollbar are integration providers that use core's generic external-
item store rather than owning a plugin database.

## The plugin API

`packages/plugin-api` (`@acorn/plugin-api`) is the only host package a plugin's production code may
import. It adds no behavior of its own: it re-exports an enumerated slice of node-core and
client-core, and `tools/arch/boundaries.test.ts` enforces both halves of that — plugins reach the
host only through the facade, and the facade only re-exports.

Four entrypoints:

| Entrypoint | What it carries |
| --- | --- |
| `@acorn/plugin-api/node` | `NodePlugin` and the context types, the route toolkit (`AppEnv`, `requireUser` and friends, `respondError`, the bridge), per-plugin SQLite and migrations, the `CoreServices` type, capability ids, provider and integration contracts |
| `@acorn/plugin-api/client` | `ClientPlugin`, the API client and query options, client events, contribution types, task/workspace/fleet state, and the design system's plain functions (`cx`, `token`, metrics) |
| `@acorn/plugin-api/ui` | Everything that is a component: primitives, `Icon`, `Picker`, `Modal`, `Tabs`, the diff rows, and the registration seams that live in a `.tsx` module |
| `@acorn/plugin-api/ui/diff` | The diff model, virtualizer, hydration and find pass |

The line between `/client` and `/ui` is drawn by the runtime, not by taste. Each entrypoint is a
barrel, so importing one member evaluates all of them, and Solid compiles a component to code that
touches `window` at module scope. Anything reached through a `.tsx` module therefore lands on `/ui`,
which keeps `/client` loadable from a plugin's node-environment test suite. A boundaries rule
enforces it.

`packages/plugin-api/src/surface.snapshot.txt` pins every exported name. A change to the surface
fails that test until the snapshot is regenerated
(`UPDATE_SURFACE=1 pnpm --filter @acorn/plugin-api test`), which is the point: growing the contract
should be a deliberate act. The implementation still lives in
`packages/node-core/src/server/plugin/types.ts` and
`packages/client-core/src/registries/plugin.ts`, which stay free to move files around underneath.

Two things stay outside the facade. `@acorn/protocol` is the shared wire-type package and is
imported directly. And plugin TEST code may still reach node-core and client-core: a test that seeds
core's tables, builds a real `CoreServices` or opens a temp-directory database is reaching for the
host rather than for an API, and a second ratchet in the boundaries test reviews what it reaches.
That is a first-party privilege; a third-party author gets a testkit entrypoint if and when one is
built.

## Activation

`apps/node/src/server/plugins.ts` is the Node activation list. `apps/desktop/src/app/client/plugins.ts`
is the client activation list. The host validates unique names, applies the per-Node disabled-plugin
set, initializes enabled plugins, runs the optional ready/activation pass, and owns disposal of their
registrations.

Required plugins are agents, memory, notes, and terminal. GitHub is optional: when enabled it contributes
the provider, PR rail, importer, and mirror routes; when disabled core Home and the remaining plugins
still boot.

Optional plugins can be disabled per Node through Settings → Plugins; their SQLite files remain on
disk and can be re-enabled later.

Node initialization happens before the listener accepts requests. A plugin can register:

- routes under `/v2/p/<plugin>/...`;
- typed capabilities;
- client broadcasts through `ctx.events`;
- agent tools and task-context sections;
- integration, connection, and model-provider descriptors;
- a plugin-owned SQLite migration chain and disposal hook.

The host supplies `CoreServices` for confined filesystem access, Git, processes, secrets, tasks,
repositories, task context, model generation, preferences, and the machine identity. Plugins do not
receive the core database handle merely to query shared tables.

It supplies no HTTP client. This list named one, and none exists — see docs/http-client.md for why
that matters and when it will have to.

### Loaded plugins

A Node can also load a plugin's node half from disk, from `<dataRoot>/plugins/<id>/` — a directory
holding an `acorn-plugin.json` manifest and an ESM bundle that default-exports a `NodePlugin`
(`packages/node-core/src/main/pluginManifest.ts`, `pluginLoader.ts`). Loaded plugins join the same
array and the same host pass as the compiled-in ones, so ordering, `ready`, capability late-binding
and disposal are identical.

Three things differ, and all three follow from the code not being ours:

- **The loader is off unless `ACORN_UNSAFE_PLUGINS=1`.** The install-time trust prompt does not exist
  yet (docs/third-party/phase-2-distribution-trust.md, phase 5), and running third-party code the user
  never agreed to is not a default worth having. The flag goes away when the prompt arrives.
- **Failures are contained.** A built-in throwing from `init` still fails the boot — it is first-party
  code in the same binary, and a node that cannot assemble should say so. A loaded plugin throwing has
  its registrations rolled back, is reported through the roster (`state: 'failed'`) and the attention
  inbox, and the node keeps starting.
- **The context is shaped by the manifest.** `permissions.node` decides which `CoreServices` facets
  and capability ids the plugin can see; `ctx.routes.register` (Hono), `ctx.events.channel` and
  `ctx.events.streams` are never present, whatever the manifest says. A loaded plugin serves routes as
  `ctx.routes.fetch(handler)` instead — a `(Request) → Response` function, which is the one shape that
  survives moving plugins out of process later.

That last point is least privilege for **cooperative** code and honest disclosure for users, not a
security boundary: a loaded bundle shares the Node's process and can `import('node:fs')` and ignore
`ctx` entirely. `docs/third-party/node-security.md` is the full threat model, and every surface that
renders these permissions has to say *declared*, not *enforced*.

`apps/node/scripts/build-plugin.mjs` builds a first-party plugin into this shape for development; it
is not the distribution mechanism.

Client initialization is synchronous registration. The host exposes contribution points for panes,
sources, settings pages, shell/task slots, context sections, provider reference panels, palette rows,
agent contexts, agent-tool renderers, pollers, persisted-state slices, Node statistics, and attention
items. An activation pass handles subscriptions or local storage initialization after all descriptors
exist.

## Collaboration rules

Plugins collaborate through four mechanisms:

1. **Contracts** — import only a provider's `contract/` entrypoint for types, capability IDs, or
   narrow pure functions.
2. **Capabilities** — resolve typed functions from the Node's per-runtime capability registry at
   call time. This is the Node's only late-binding mechanism: route handlers receive a read-only
   capability view through `RuntimeBindings`, while plugin providers register during `init`. Missing
   optional providers produce a degraded feature, not a module import. The small helpers in
   `server/bridge.ts` are typed route adapters; their setter functions exist only for isolated route
   tests and are never used by production composition.
3. **Broadcasts** (`ctx.events`) — tell connected CLIENTS that something changed. This is not a
   plugin-to-plugin channel and there is no subscribe side: nothing in the node listens. It is an
   invalidation channel over the authenticated WebSocket — no durability, no replay, no delivery
   guarantee — and a client that misses one refetches after the gap. Durable history belongs in the
   owning plugin's tables. Two plugins that need to talk use a capability (2).
4. **Client registries and slots** — register UI contributions without importing another plugin's
   implementation. The host records disposables so disabling/reloading a plugin removes its entries.

The architecture test enforces zero non-contract plugin-to-plugin edges, no app imports from packages
or plugins, no Electron imports outside the allowed desktop surface, protocol purity, declared
dependencies, an acyclic package graph, and the client/Node split.

## Data ownership

Table-owning plugins open one `plugins/<name>.sqlite` file under the Node data root and own its
migrations. Current table-owning plugins include agents, changes, database, GitHub, HTTP, memory,
notes, terminal, and workflows. Core owns shared workspace/task/integration/external-item/security
tables. Docker, editor, Linear, Rollbar, model providers, preview, and the built-in agents profiles
use core services or provider registries without owning a database file.

There are no cross-file foreign keys, `ATTACH` queries, or transactions spanning plugin databases.
Cross-plugin workflows use durable operation state and explicit IDs/capabilities.

## Tool projection

A plugin registers schema-validated agent tools with risk metadata. Core projects the registry into:

- the task-scoped HTTP tool surface;
- the stdio MCP server used by spawned agents;
- renderer permission and tool-description UI.

The caller's internal-token scope and the owner's tool permission settings are both applied. Tool
implementations run in the Node and use CoreServices; the renderer and MCP process do not open plugin
databases directly.

## Adding a plugin contribution

1. Put the behavior in the owning plugin and choose the correct runtime directory.
2. Use CoreServices rather than importing core implementation modules or another plugin's internals.
3. Add a narrow `contract/` export, capability, or client registry entry when collaboration is
   needed; `ctx.events` if the renderer needs telling.
4. Register the Node/client entry in the appropriate composition list.
5. Add package-local tests and, for rendered behavior, desktop e2e coverage.
6. Run the architecture test, `pnpm lint`, and the relevant tests.
