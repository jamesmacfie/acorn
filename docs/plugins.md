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

Not every plugin has every directory. The profile packages are Node-only adapters. Onboarding is a
client overlay with core setup support. Linear and Rollbar are integration providers that use core's
generic external-item store rather than owning a plugin database.

The current Node plugin interface is defined in
`packages/node-core/src/server/plugin/types.ts`; the client interface is in
`packages/client-core/src/registries/plugin.ts`. There is no separate `plugin-api` package.

## Activation

`apps/node/src/server/plugins.ts` is the Node activation list. `apps/desktop/src/app/client/plugins.ts`
is the client activation list. The host validates unique names, applies the per-Node disabled-plugin
set, initializes enabled plugins, runs the optional ready/activation pass, and owns disposal of their
registrations.

Required Node plugins are GitHub, terminal, and agents. Required client contributions also include
the pieces the shell needs from notes and memory. Optional plugins can be disabled per Node through
Settings → Plugins; their SQLite files remain on disk and can be re-enabled later.

Node initialization happens before the listener accepts requests. A plugin can register:

- routes under `/v2/p/<plugin>/...`;
- typed capabilities;
- client broadcasts through `ctx.events`;
- agent tools and task-context sections;
- integration, connection, and model-provider descriptors;
- a plugin-owned SQLite migration chain and disposal hook.

The host supplies `CoreServices` for confined filesystem access, Git, processes, secrets, tasks,
repositories, preferences, HTTP, and other core operations. Plugins do not receive the core database
handle merely to query shared tables.

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
   call time. Missing optional providers produce a degraded feature, not a module import.
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
tables. Docker, editor, Linear, Rollbar, model providers, preview, and profile packages use core
services or provider registries without owning a database file.

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
