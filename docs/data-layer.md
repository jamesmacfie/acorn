# Data layer

This page is the map of how a Node stores data: one core database, one database per table-owning
plugin, a content-addressed blob cache, and the rules for who owns what. Read it before you add a
table, a file in the data root, or a cache.

The Node is the only owner of authoritative application data. SQLite runs on the runtime's
`node:sqlite` with Drizzle. The package that owns a schema owns its migration chain. Plugin databases
are independent: no cross-database foreign keys, `ATTACH`, or transactions spanning files.

## Pages

<a id="data-root"></a>

[The data root](./data-layer/data-root.md) covers where the root lives, what's in it, `node.json`, and
how `openDataRoot` opens it.

<a id="core-database"></a>
<a id="external-item-read-model"></a>
<a id="runs-a-merged-read-and-the-trigger-for-ever-making-it-a-table"></a>
<a id="task-script-persistence"></a>

[The core database](./data-layer/core-database.md) covers core's tables, the external-item read model,
the merged run list, and task script history.

<a id="plugin-databases"></a>
<a id="database-plugin-the-postgres-pane"></a>

[Plugin databases](./data-layer/plugin-databases.md) covers each plugin's SQLite file, how a plugin
opens its handle, the cross-database ledgers, and the GitHub mirror.

<a id="migrations"></a>

[Migrations](./data-layer/migrations.md) covers generating and checking migrations, where each chain is
found, the applied-history check, and loaded plugin storage.

<a id="backup-and-import"></a>
<a id="retention"></a>
<a id="what-the-node-reports"></a>

[Backup and retention](./data-layer/backup-and-retention.md) covers backup archives and restore,
retention per kind of record, `VACUUM`, and the storage report.

<a id="shared-typed-values"></a>
<a id="typed-data-sources-projections-never-second-stores"></a>

[Typed data](./data-layer/typed-data.md) covers the shared typed-value contract and why a data source
never becomes a second store.

## Ownership rules

Provider data is a disposable read model. GitHub, Linear, and Rollbar stay the source of truth, and a
refresh can delete and rebuild local rows. Application-owned state survives provider refreshes.

Machine-scoped entities include workspaces, tasks, notes, memories, terminal metadata, worktrees, and
project configuration. Identity-scoped records use the Node's opaque owner id, bound at first boot. A
provider account change must not alter the owner's settings, integrations, or saved requests.

The shared `blobs/` directory is content-addressed. It stores immutable patch bodies and their diff
document descriptors by patch digest, and file bodies, attachments, and artifacts by SHA. A plugin row
may keep a blob until the owning record is deleted ([caching](./caching.md#immutable-blob-cache)).

<a id="preferences-and-client-persistence"></a>

Node preferences live in the core `prefs` table, behind the core prefs routes. Device presentation
preferences, client persistence, and the per-Node query cache belong to the client
([state ownership](./state-ownership.md)).
