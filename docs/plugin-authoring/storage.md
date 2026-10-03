# Storage and migrations

This page covers how a loaded plugin owns tables: shipping a migration chain, opening the database,
and changing the schema across updates. It's part of [plugin authoring](../plugin-authoring.md).

## Storage and migrations

A table-owning plugin ships a Drizzle chain inside its package and names it in the manifest's
`migrations` field. The host, never the plugin, opens the database and applies the chain at
`ctx.storage.open()` (`openPluginDb` in `server/plugins/storage.ts`). The file is
`<dataRoot>/plugins/<id>.sqlite`, and the handle is a drizzle handle with `batch` and `close`. Declare
`drizzle-orm` as your own dependency and narrow the handle, because `acorn-plugin-types` declares it
as host-owned.

The chain must be a real chain. `pluginMigrationsChain` requires `meta/_journal.json` in the declared
directory, because a directory without a journal applies nothing. A plugin that opens storage while
declaring no `migrations` gets a `PluginMigrationsError`, not an empty database. A journal is small
enough to write by hand:

```json
{
  "version": "7",
  "dialect": "sqlite",
  "entries": [
    { "idx": 0, "version": "6", "when": 1786177106101, "tag": "0000_init", "breakpoints": true }
  ]
}
```

Put `0000_init.sql` beside it with the DDL. A broken chain fails contained: that plugin ends up
`failed`, the Node boots, and other plugins aren't affected.

## Updating a plugin, and the data underneath it

Keep the plugin id stable, because the filename comes from it, and append migrations. Applied
migrations can't change. Before an update or reload runs new SQL, acorn compares each applied row with
the journal position, timestamp, and SHA-256 of its SQL file. If you edit an applied file, reorder the
journal, or remove an applied entry, the plugin fails without changing its database. Restore the
original chain and add a new migration for the next change.

The installer rejects a lower version unless the caller asks for a downgrade, and a downgrade doesn't
reverse migrations. To recover from a failed update, restore a compatible database backup, or
reinstall with `purgeData` if you can discard the plugin's data. Uninstall keeps data by default.

A development reload can roll back registrations after a failed init, but it can't undo a migration
that already ran ([the dev loop](../plugins/dev-loop.md)). [Data ownership](../plugins/data-ownership.md)
covers what the host owns and what uninstalling removes.
