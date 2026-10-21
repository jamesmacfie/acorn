# Data layer

This page is the map of how a Node stores data: one core database, one database per table-owning
plugin, a content-addressed blob cache, and the rules for who owns what. Read it before you add a
table, a file in the data root, or a cache.

The Node is the only owner of authoritative application data. SQLite runs on the runtime's
`node:sqlite` with Drizzle. The package that owns a schema owns its migration chain. Plugin databases
are independent: no cross-database foreign keys, `ATTACH`, or transactions spanning files.

The core migration chain also owns `datasets`, immutable `dataset_versions`, `dataset_rows`,
`dataset_corrections`, `dataset_captures`, and `dataset_coverage`. A dataset has one storage mode,
feeder, scope, and retention policy. Corrections are separate from feeder rows so a later capture
or agent write cannot erase them; they count toward the byte cap and remain until dataset deletion.
A dataset's row and byte counts live on its `datasets` row, kept by triggers on the rows and
corrections tables, so a write checks its caps without summing them. A run's pages of a dataset come
from one read, held by the selection pager, not from a read for each page.
The daily dataset compactor applies per-dataset row and coverage retention;
current stat measure history remains in its existing tables and compactor.

## Pages

[The data root](./data-layer/data-root.md) covers where the root lives, what's in it, `node.json`, and
how `openDataRoot` opens it.

[The core database](./data-layer/core-database.md) covers core's tables, the external-item read model,
the merged run list, and task script history.

[Plugin databases](./data-layer/plugin-databases.md) covers each plugin's SQLite file, how a plugin
opens its handle, the cross-database ledgers, and the GitHub mirror.

[Migrations](./data-layer/migrations.md) covers generating and checking migrations, where each chain is
found, the applied-history check, and loaded plugin storage.

[Backup and retention](./data-layer/backup-and-retention.md) covers backup archives and restore,
retention per kind of record, `VACUUM`, and the storage report.

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

Node preferences live in the core `prefs` table, behind the core prefs routes. Device presentation
preferences, client persistence, and the per-Node query cache belong to the client
([state ownership](./state-ownership.md)).
