// Per-plugin SQLite (docs/data-layer.md § Plugin DBs: "Each plugin gets its own SQLite file, opened
// and migrated by core's storage service at plugin init. The plugin owns its schema and its Drizzle
// migration chain.").
//
// Two reasons this is a separate function rather than a parameter on openDb:
//
//   1. Core cannot import a plugin's schema — @acorn/node-core is a lib, and a lib importing a plugin
//      is a boundary violation (tools/arch/boundaries.test.ts rule 6). So the CHAIN is supplied per
//      tier: a built-in declares the module it sits beside (builtinPluginStorage below), a loaded
//      package declares a confined directory in its manifest. Core owns the file either way, and
//      hardening plus migration run in both cases.
//   2. The handle stays in the owning plugin's closure, NOT on `Env`. `c.env` reaches every core and
//      plugin route (main/bindings.ts), so a per-plugin DB there would be readable by all routes.
//
// docs/data-layer.md forbids cross-DB queries, ATTACH, and transactions spanning files. Cross-plugin references
// are plain IDs, dereferenced through the owning plugin.
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { PluginStorage } from '../server/plugin/types'
import { pluginMigrationsFolder } from './pluginMigrations'
import { drizzleOverSqlite, openSqlite } from './sqlite'

// One directory for every plugin DB, so a backup can enumerate them without knowing the plugin list
// (docs/data-layer.md § Backup) and so `plugins/` is visibly separate from core.sqlite in a data root.
export const PLUGIN_DB_DIR = 'plugins'

const PLUGIN_ID_RE = /^[a-z][a-z0-9-]*$/

export type PluginDatabase = ReturnType<typeof drizzleOverSqlite> & {
  batch: <T extends readonly unknown[]>(statements: T) => Promise<unknown[]>
  close: () => void
}

export const pluginDbPath = (dataDir: string, plugin: string): string => join(resolve(dataDir), PLUGIN_DB_DIR, `${plugin}.sqlite`)

export function openPluginDb(dataDir: string, plugin: string, options: { migrationsFolder: string }): PluginDatabase {
  // The plugin id becomes a filename, so validate it here rather than trusting the caller — the same
  // rule the route registry applies to a plugin's namespace.
  if (!PLUGIN_ID_RE.test(plugin)) throw new Error(`Plugin database id must match ${PLUGIN_ID_RE.source}: '${plugin}'.`)

  const databasePath = pluginDbPath(dataDir, plugin)
  const dir = join(resolve(dataDir), PLUGIN_DB_DIR)
  // Same hardening as openDb: the directory and the file are created privately BEFORE journal_mode,
  // because SQLite derives WAL/SHM permissions from the database file.
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  closeSync(openSync(databasePath, 'a', 0o600))
  chmodSync(databasePath, 0o600)

  const sqlite = openSqlite(databasePath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('busy_timeout = 5000')

  // Same session and same handle as openDb (main/bindings.ts). Note a plugin schema MAY declare
  // foreign keys — main/sqlite.ts keeps enforcement off, matching what better-sqlite3 did, so no
  // plugin gets enforcement it was never written against.
  const db = drizzleOverSqlite(sqlite)
  migrate(db, { migrationsFolder: options.migrationsFolder })
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (existsSync(path)) chmodSync(path, 0o600)
  }

  const withBatch = db as unknown as PluginDatabase
  // `.batch([...])` as a synchronous transaction, matching openDb. It is all-or-nothing WITHIN this
  // file only — docs/data-layer.md is explicit that a transaction never spans databases.
  withBatch.batch = (async (statements: ReadonlyArray<{ run(): unknown }>) =>
    db.transaction((_tx) => statements.map((stmt) => stmt.run()))) as PluginDatabase['batch']
  withBatch.close = () => sqlite.close()
  return withBatch
}

// The compiled tier's half of `ctx.storage`, so a built-in stops hand-rolling a lifecycle the host
// already owns for loaded plugins. Same factory, same filename, same hardening as the loader's binding
// (main/pluginLoader.ts); the ONE difference is where the chain comes from — a built-in's is staged with
// the app and resolved from the module that declared it, a loaded package's is confined to its own
// directory by its manifest.
//
// Lazy, like the loader's: nothing touches the filesystem until the plugin's init calls open(), so the
// host can build this for every plugin in the graph and a disabled plugin still creates no database.
export function builtinPluginStorage(dataDir: string, plugin: string, moduleUrl: string): PluginStorage {
  // A module URL, not a directory — the ancestor walk has to start from the PLUGIN's module
  // (main/pluginMigrations.ts). Checked here because the alternative is fileURLToPath's bare
  // "Invalid URL" with no mention of which plugin declared it.
  if (!moduleUrl.startsWith('file:')) {
    throw new Error(`Plugin '${plugin}' declares migrationsModule '${moduleUrl}'; it must be that module's own import.meta.url.`)
  }
  return { open: () => openPluginDb(dataDir, plugin, { migrationsFolder: pluginMigrationsFolder(plugin, moduleUrl) }) }
}
