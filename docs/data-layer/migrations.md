# Migrations

This page covers how core and plugin schemas change: generating a migration, where each chain is found
at run time, how applied history is checked, and the storage policy for loaded plugins. Read it before
you change a schema. It's part of the [data layer](../data-layer.md).

## Change a schema

1. Edit the schema in the package that owns it.
2. Run `pnpm db:generate`.
3. Check every chain with `pnpm db:check`.

Launching a Node applies pending migrations. Core and eight plugins own chains: agents, browser,
changes, database, github, http, terminal, and workflows. Each starts from one baseline migration, and
later migrations append to it. Older SQL histories and their one-way data transformations aren't an
upgrade path into a baseline. Run the recoverable reset in [local development](../local-development.md)
before starting a Node on an older data root. It keeps a private recovery copy and never removes
repositories or worktrees.

## Where a chain lives

A built-in's chain is in one of three places, depending on how the Node runs:

- a source checkout: `plugins/<name>/migrations/`;
- a built desktop app before packaging: `apps/desktop/out/migrations/<name>/`, beside core's chain at
  `out/migrations/`;
- a packaged app: `<resources>/migrations/<name>/`.

`pluginMigrationsFolder` in `packages/node-core/src/server/plugins/migrations.ts` finds it by walking up
from the plugin's own module URL, never from node-core's, so a plugin can't adopt node-core's chain by
proximity. At each level it checks `migrations/<plugin>/` before a bare `migrations/`, because the
built and packaged layouts put core's chain and a plugin's side by side. The walk never crosses the
plugin's package root, so a missing chain fails instead of adopting an ancestor's DDL.

A loaded plugin skips the walk. Its manifest names a directory confined to its package, and
`pluginMigrationsChain` only checks that a Drizzle chain is there. `apps/node/scripts/build-plugin.mjs`
copies the chain into the built package, because the package is the only copy the loader reads. The
database and http plugins take this path.

## Applied history is checked

Before applying anything, core and plugin paths compare every row in `__drizzle_migrations` with the
matching journal entry: its timestamp, its position, and the SHA-256 of the SQL file. Edited applied
SQL, a reordered journal, or a removed applied entry fails with a recoverable-reset instruction, and so
do tables with no applied history. The check runs on the same handle before Drizzle migrates, so the
database is left unchanged.

`apps/node/test/integration/plugins/httpLoaded.test.ts` covers a loaded plugin's chain growing between
versions against a database that already has rows, a broken chain failing contained, and
uninstall-without-purge keeping the file.

## Opening loaded storage

The host opens a built-in's file lazily on first use. For a loaded plugin with migrations, the loader
prepares the three exact SQLite paths before it starts the worker, so it can grant those files without
granting the shared `plugins/` directory. The worker still opens the database lazily.

- Preparation refuses a linked `plugins/` directory and checks that each state file is regular before
  opening it. POSIX hosts add no-follow and nonblocking flags and set the private mode through the
  opened descriptor.
- Windows preparation keeps the directory and regular-file checks but relies on the data root's access
  control list for privacy, because POSIX mode bits don't restrict Windows access.
- Worker and host opens check a database, WAL, or SHM file that is already there before handing its
  path to SQLite. Absent sidecars stay valid. Grants include both the lexical and canonical spellings of a
  data-root alias. None of this removes the path-swap race before SQLite opens.

Loaded storage installs a native authorizer before migration history or plugin SQL runs. It refuses
cross-file attachment and export, limits PRAGMAs and virtual table modules, and keeps temporary storage
in memory. A runtime without SQLite authorization support refuses loaded storage, and the bundled Node
24 supports it ([plugin storage security](../security/plugin-storage-and-supply-chain.md#storage)).

## Full-text search tables

Drizzle-kit can't model a virtual table, so a plugin that wants FTS5, such as `agent_events_fts` in
`agents.sqlite`, writes the `CREATE VIRTUAL TABLE` and its triggers by hand into its migration SQL. The
schema file still declares the backing columns the triggers read. A schema-drift test catches a missed
rename by opening the migrated database and checking the virtual table's shape against the schema,
because a trigger body is plain SQL with no type checker. `plugins/agents/src/server/ftsSchema.test.ts`
is the pattern to copy.
