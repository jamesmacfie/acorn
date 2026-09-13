# A host-mediated data capability for plugins

Proposal, 2026-09-14. Not started. Paths below are hints, not promises; re-check them against the
tree before building (see "Verify before building" at the end). Where this disagrees with an owning
doc, the owning doc wins.

## What this is

A host-owned facet, `ctx.core.data`, that lets a plugin run bounded queries against a database the
host connects to on its behalf. The host holds the driver, the socket, and the credential. The
plugin references a connection by id and never opens a socket or sees a secret. It is the same shape
as the model service (`ctx.core.models`), applied to databases.

The database plugin is the first consumer, but this is not a database-plugin fix. It is a seam built
so that a third-party plugin could do what the database plugin does, contained, and so that a whole
class of data plugins (schema browsers, query dashboards, ERD viewers, migration linters) can be
built on top without any of them holding a raw socket.

## Why we should do it

Three reasons, in order of weight:

1. It restores the database plugin without punching a hole in the sandbox. The plugin stops bundling
   a driver, so it loads cleanly and needs no raw network access.
2. It turns the manifest's network allowlist into real enforcement for database traffic. Because the
   host dials, the connection's host and port are actually enforced, which a plugin holding a raw
   socket cannot do at the current sandbox rung (`docs/security.md § The containment ladder`, rung 3).
3. It creates a reusable, contained seam for the whole data-integration class named in
   `docs/future/integration-ideas.md` (Postgres, MySQL, Redis, MongoDB, Kafka, and the feature
   plugins built on them), so future third-party plugins get the safe path from day one.

## How we got here (history)

The chain is worth keeping, because it explains why the obvious fixes are wrong.

- A Linear rail error ("Zoidberg unavailable, /v2/p/linear/rail-items 404") turned out to be the
  Linear plugin failing to load. Its built bundle imported `node:module`, which the loaded-plugin
  sandbox forbids (`packages/node-core/src/server/plugins/nodePluginWorker.ts`). The cause was an
  accidental one: `ws` leaked into Linear's node graph through `wsHub.ts`, the plugin builder inlines
  every non-builtin, and inlining a CommonJS package makes the bundler emit `createRequire` from
  `node:module`. That leak was fixed by loading `ws` lazily in `attachWsHub`
  (`packages/node-core/src/server/transport/wsHub.ts`; the change is on this branch and not yet
  committed).
- The same scan showed the database plugin failing the same way, but for a real reason. It depends on
  `pg` directly (`plugins/database/package.json`) and opens Postgres over raw sockets
  (`plugins/database/src/server/database.ts`, `new Pool({ connectionString })`). So it hits two walls:
  the CommonJS load wall (`node:module`) and the socket wall (`net` and `tls` are on the sandbox deny
  list).
- It used to work because it used to be a compiled, in-process plugin with full network access. The
  "move more to third party framework" migration pushed it into the loaded, sandboxed tier
  (`apps/desktop/scripts/build-bundled-plugins.mjs`; it is absent from the compiled roster in
  `apps/node/src/composition/plugins.ts`). The sandbox denies raw sockets by design, so the move
  broke it.
- We weighed three fixes: move it back to compiled (works, but a compiled plugin does not exist for a
  future third-party author and is a step away from the loaded contract); grant it raw sockets behind
  a new permission (honest on the trust modal, but at the current rung it is trust, not containment,
  and the project has an on-record refusal about widening the sandbox in
  `docs/future/ecosystem/refused.md`); or move the driver behind a host capability. We chose the
  capability, because it keeps the plugin contained and generalizes to the whole class.

## The design

### The facet

Add `ctx.core.data`, alongside `ctx.core.models`, gated by a new `data:query` node permission. Loaded
plugins get the facet only when they declare the permission; rung 1 gates core facets by omission, so
an undeclared facet is simply absent from `ctx.core` (`docs/security.md`, rung 1). The permission
renders as one line in the trust modal, such as "Query the databases you've connected", added to the
node-permission descriptions in `packages/client-core/src/host/trust/permissions.ts`.

### The contract

The facet is engine-neutral. A consumer names a connection and a statement; the host resolves the
credential, dials, runs, and returns rows:

- `connections()` returns connection ids, labels, and engine kind only, the way `models.available()`
  returns backends without keys. A plugin's connection picker gets what it needs and nothing more.
- `query(connectionId, sql, { maxRows, readOnly, timeoutMs })` returns
  `{ columns, rows, rowCount, truncated }`, the shape the pane already renders. Read-only by default,
  reusing today's `readOnlyRefusal` (`plugins/database/src/contract/query.ts`). A later `data:write`
  grant, drawn high on the modal, opens writes.
- `schema(connectionId)` returns tables and columns for the browser and for SQL generation.

The row cap, the read-only refusal, and the timeout live once in core, where `DatabaseQuery` and
`MAX_QUERY_ROWS` put them today, so every consumer inherits the same limits.

### Where the driver lives, and the decision behind it

The driver and the socket live in core. This is the one place the design differs from the model
service: a model adapter can run inside the plugin because it talks HTTP and `fetch` to a declared
host is allowed, but a database driver needs raw sockets, so keeping consumers contained means the
host runs the driver.

Core owns `pg` now, and MySQL, Redis, and others as they are wanted, as trusted infrastructure behind
the facet. That has one honest limitation: adding a brand-new engine is a core contribution, not a
third-party drop-in. That fits the project's "the fat core is the end state" stance
(`docs/future/ecosystem/refused.md`), and it ships now.

We deliberately did not build the alternative, a host-mediated socket broker where the host dials and
hands the plugin a byte stream so the driver can run in the plugin. That would let a third party ship
a new engine themselves, contained, but it is substantial (a `net.Socket` shim over the worker RPC,
backpressure, and the CommonJS-loading problem again) and it sits right next to the rung-3 OS
sandboxing that `docs/security.md` defers. The facet contract is the stable seam: consumers call
`query(connectionId, sql, opts)` either way, so choosing "driver in core" now forecloses nothing. If
the socket broker is ever built, the driver moves under the same contract without touching a consumer.

### Connections and credentials

A database connection is configured once, the way integrations already are: engine, host, port,
database, and a credential in core's secret store. Reuse the connection registry
(`packages/node-core/src/server/integrations/connections.ts` and `connectionRegistry.ts`) rather than
building a parallel one. Plugins reference a connection by id and never see the connection string or
the credential. `query()` resolves the secret inside core, the way `generateText` does, so the key
never enters the plugin realm.

The database plugin is task-scoped today and resolves "the task's database" from repo-level config,
which is gated behind `projects:config` (`docs/` repo-settings work; the config columns on the
projects row). Core owns that resolution, so a `taskId` maps to a connection inside the facet rather
than the plugin reading config columns itself.

## What the database plugin becomes

The first consumer, and a plugin a third party could have shipped. It stops depending on `pg`, which
fixes both walls at once: no `pg` means no `createRequire`, so it loads in the sandbox, and no driver
means no raw socket. It stops providing `DATABASE_QUERY` itself and consumes `ctx.core.data` instead.
Its routes, its pane, and its two workflow steps stay as they are; only the roughly 200 lines in
`plugins/database/src/server/database.ts` that hold `new Pool` and run queries move behind the facet.
After that it is an ordinary loaded plugin with a clean bundle.

## Security properties

- The credential never enters the plugin realm; core resolves and attaches it, the same rule the
  model service and the credential-injecting broker in `docs/security.md` follow.
- The connection's host and port are enforced at dial time, because the host dials.
- Read-only, row cap, and timeout are enforced host-side, once, for every consumer.
- Connection pooling and lifecycle move into core, keyed by connection id.
- Large result sets are chunked on the way out rather than materialized whole; `chunkRowsByColumnBudget`
  (`@acorn/plugin-api/node`, from `packages/node-core/src/server/rows.ts`) is the existing precedent.

## Scope of work

1. Add the `DataSourceService` to node-core: it owns `pg`, the pool per connection id, and the query,
   schema, and connections methods, with the caps enforced in one place. Model it on
   `packages/node-core/src/server/core/models.ts`.
2. Expose it as `ctx.core.data` in the CoreServices assembly (`packages/node-core/src/server/core/index.ts`)
   and gate it by omission in the loaded-plugin context builder
   (`packages/node-core/src/server/pluginHost/context.ts`), matching how `models` is gated.
3. Add the `data:query` permission to the manifest schema
   (`packages/protocol/src/plugin/contract.ts`, the `permissions.node` block) and its trust-modal line
   to `packages/client-core/src/host/trust/permissions.ts`, drawn high.
4. Resolve connections through the existing connection registry and secret store; add a
   `taskId`-to-connection resolution that reads the repo's database config in core.
5. Rewrite `plugins/database/src/server/database.ts` to call `ctx.core.data` instead of opening a pool;
   drop `pg` from `plugins/database/package.json`; keep the routes, pane, and workflow steps.
6. Re-bundle the database plugin and confirm two things: its `dist/node.js` no longer imports
   `node:module`, and a real Postgres query runs through the pane and the two workflow steps.

## Boundaries and decisions already made

- Driver in core now, not the socket broker. Revisit only if third-party engine plugins become a
  goal, which is the rung-3 conversation.
- Read plus schema on day one, matching what `DATABASE_QUERY` ships today. Writes, transactions, and
  cursors are later grants, each its own trust-modal line.
- Reuse the integration-connection registry rather than a new connections table.

## Verify before building

Code moves; check these before you lean on them.

- The sandbox deny list and how grants map to it: `packages/node-core/src/server/plugins/nodePluginWorker.ts`
  and `isolation.ts`.
- The model-service precedent still shaped as a `ctx.core` facet gated by a permission:
  `packages/node-core/src/server/core/models.ts`, `core/index.ts`, and the facet gating in
  `pluginHost/context.ts`.
- The current query contract and its caps: `plugins/database/src/contract/query.ts`.
- The database plugin's node entry and its `new Pool` call: `plugins/database/src/node/index.ts` and
  `plugins/database/src/server/database.ts`.
- The compiled and bundled rosters: `apps/node/src/composition/plugins.ts`,
  `apps/desktop/src/client/plugins.ts`, and `apps/desktop/scripts/build-bundled-plugins.mjs`.
- The containment ladder and the fat-core stance: `docs/security.md § The containment ladder`,
  `docs/extensibility.md § Two tiers, permanently`, and `docs/future/ecosystem/refused.md`.
