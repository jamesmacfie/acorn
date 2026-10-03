# Data ownership

This page covers which plugins own a database, how the host opens and migrates it, what uninstalling
removes, and how agent tools reach plugin data. It's part of the [plugin reference](../plugins.md).

## Data ownership

A table-owning plugin gets one `plugins/<name>.sqlite` file under the Node data root and owns its
migrations. Eight plugins own one: agents, browser, changes, database, GitHub, HTTP, terminal, and
workflows. Core owns the shared workspace, task, integration, external-item, and security tables.
Docker, editor, Linear, Rollbar, model providers, preview, memory, notes, and the built-in agent
profiles use core services, provider registries, or plain files. Notes writes Markdown under
`<data-root>/notes`.

Both tiers get their handle from `ctx.storage.open()`, and the host owns the lifecycle. It opens the
file on the first call, applies the chain, returns the same handle to every later call in that boot,
and closes it right after the plugin's `dispose()`, inside the `plugins` step of `NODE_DRAIN_ORDER`,
before core's SQLite and the data-root lock. A plugin's `dispose` is for what the plugin opened
itself, such as timers, child processes, and pools.

Each tier declares its chain differently:

- **A compiled plugin** sets `migrationsModule: import.meta.url` on its `NodePlugin`. The host walks
  from that module to the chain, which covers all three runtime layouts: `plugins/<id>/migrations/` in
  a source tree, `out/migrations/<id>/` in a build, and `<resources>/migrations/<id>/` when packaged
  (`packages/node-core/src/server/plugins/migrations.ts`).
- **A loaded plugin** declares a package-relative `migrations` directory in `acorn-plugin.json`. The
  loader confines and validates the chain, and the host binds the filename to the manifest id. A
  `migrationsModule` on a loaded plugin's export is ignored, so a bundle can't point the migrator
  outside its package.

With no declaration there's no storage: `ctx.storage` is absent. A plugin never names the file, the
data root, or the chain's directory. `build-plugin.mjs` stages the declared directory into the package,
because Drizzle reads the journal and the SQL files at migrate time.
`apps/node/test/integration/plugins/httpLoaded.test.ts` covers a schema change arriving through an
installer update against a populated database, a broken chain failing contained, and uninstall
without purge keeping the file. The filename comes from the manifest id, so a table-owning package
can never change its id without orphaning its rows.

There are no foreign keys, `ATTACH` queries, or transactions across plugin databases. Cross-plugin
work uses durable operation state and explicit ids or capabilities. [Plugin
databases](../data-layer/plugin-databases.md) covers each file, and [storage and
migrations](../plugin-authoring/storage.md) covers the chain an author writes.

## Uninstalling

Uninstall removes the package directory and its lockfile. With `purgeData`, it also removes the
plugin's SQLite file and its WAL files, then everything in the core database keyed by the plugin id:
the `plugin:<id>:*` preference rows and the `schedule_state` and `schedule_runs` rows under `<id>:`.
That last part is `cascadeDeletePluginData` (`packages/node-core/src/server/db/cascade.ts`). Disk goes
first and the database second, so a failure leaves the plugin gone, not a running plugin whose state
was deleted under it.

A purge doesn't reach two things, and the audit row says so. A pane id inside a core-owned layout blob
(`core:task-layouts`) stays, and the layout normalizer drops an id no registered pane answers to.
Cached external items belong to the owner's connection, not the plugin, and disconnecting the
connection clears them.

Without `purgeData`, nothing is deleted, the same as disabling: installing again finds the data where
it was.

## Tool projection

A plugin registers schema-validated agent tools with risk metadata. Core projects the registry into
the task-scoped HTTP tool surface, the stdio MCP server spawned agents use, and the renderer's
permission and tool-description UI. The caller's token scope and the owner's tool permission settings
both apply. Tools run in the Node and use `CoreServices`. The renderer and the MCP process never open
plugin databases. [Plugin tools](../agent-tools/plugin-tools.md) owns the details.
