// Per-plugin SQLite (docs/data-layer.md § Plugin databases).
//
// Two reasons this is a separate function rather than a parameter on openDb:
//
//   1. Core cannot import a plugin's schema. @acorn/node-core is a lib, and a lib importing a plugin
//      breaks tools/arch/boundaries.test.ts rule 6. So each tier supplies its own chain: a built-in
//      declares the module it sits beside, a loaded package declares a confined directory in its
//      manifest. Core owns the file either way.
//   2. The handle stays in the owning plugin's closure, not on `Env`. `c.env` reaches every core and
//      plugin route, so a per-plugin DB there would be readable by all of them.
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { PluginStorage } from '../pluginHost/types'
import { assertPluginMigrationHistory, pluginMigrationsFolder } from './migrations'
import { drizzleOverSqlite, openSqlite } from '../storage/sqlite'

// One directory for every plugin DB, so a backup can enumerate them without knowing the plugin list
// (docs/data-layer.md § Backup), and so `plugins/` stays visibly separate from core.sqlite.
export const PLUGIN_DB_DIR = 'plugins'

const PLUGIN_ID_RE = /^[a-z][a-z0-9-]*$/

export type PluginDatabase = ReturnType<typeof drizzleOverSqlite> & {
  batch: <T extends readonly unknown[]>(statements: T) => Promise<unknown[]>
  close: () => void
}

export const pluginDbPath = (dataDir: string, plugin: string): string => join(resolve(dataDir), PLUGIN_DB_DIR, `${plugin}.sqlite`)

/** Create the three exact paths an isolated plugin realm may read and write. The realm is never
 * granted the containing directory, because that would also grant every other plugin database. */
export function preparePluginDbFiles(dataDir: string, plugin: string): readonly string[] {
  if (!PLUGIN_ID_RE.test(plugin)) throw new Error(`Plugin database id must match ${PLUGIN_ID_RE.source}: '${plugin}'.`)
  const databasePath = pluginDbPath(dataDir, plugin)
  const dir = join(resolve(dataDir), PLUGIN_DB_DIR)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  const paths = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`] as const
  for (const path of paths) {
    closeSync(openSync(path, 'a', 0o600))
    chmodSync(path, 0o600)
  }
  return paths
}

export function openPluginDb(dataDir: string, plugin: string, options: { migrationsFolder: string; prepared?: boolean }): PluginDatabase {
  // The plugin id becomes a filename, so validate it here rather than trusting the caller. Same rule
  // the route registry applies to a plugin's namespace.
  if (!PLUGIN_ID_RE.test(plugin)) throw new Error(`Plugin database id must match ${PLUGIN_ID_RE.source}: '${plugin}'.`)

  const databasePath = pluginDbPath(dataDir, plugin)
  // Same hardening as openDb: the directory and the files are created privately before journal_mode,
  // because SQLite derives WAL/SHM permissions from the database file. An isolated realm receives
  // exact-file grants and therefore asks the parent to prepare them before it starts.
  if (!options.prepared) preparePluginDbFiles(dataDir, plugin)

  const sqlite = openSqlite(databasePath)
  try {
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('busy_timeout = 5000')

    // Same session and same handle as openDb (server/bindings.ts). A plugin schema may declare foreign
    // keys, and server/storage/sqlite.ts keeps enforcement off to match better-sqlite3, so no plugin gets
    // enforcement it was never written against.
    const db = drizzleOverSqlite(sqlite)
    assertPluginMigrationHistory(plugin, options.migrationsFolder, sqlite)
    // Reload rolls back registrations, not schema.
    //
    // A live reload runs the candidate's init while the previous instance is still serving, so a
    // dev-loop iteration that adds a migration applies it here, mid-process, against a second handle
    // on the same file. If that init then throws, the host restores every registration and cannot
    // un-migrate. Nothing in this system has down-migrations, so the author iterating on the plugin
    // owns the data they just reshaped.
    migrate(db, { migrationsFolder: options.migrationsFolder })
    for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
      if (existsSync(path)) chmodSync(path, 0o600)
    }

    const withBatch = db as unknown as PluginDatabase
    // `.batch([...])` as a synchronous transaction, matching openDb. All-or-nothing within this file
    // only, since a transaction never spans databases (docs/data-layer.md § Plugin databases).
    withBatch.batch = (async (statements: ReadonlyArray<{ run(): unknown }>) =>
      db.transaction((_tx) => statements.map((stmt) => stmt.run()))) as PluginDatabase['batch']
    withBatch.close = () => sqlite.close()
    return withBatch
  } catch (error) {
    // No caller owns this handle until the factory returns. A rejected history or failed migration
    // therefore has to close it here or reload leaves an unreachable WAL lock behind.
    try {
      sqlite.close()
    } catch {
      // Preserve the validation/migration error; it is the actionable failure.
    }
    throw error
  }
}

// The compiled tier's half of `ctx.storage`, so a built-in stops hand-rolling a lifecycle the host
// owns for loaded plugins. Same factory, filename, and hardening as the loader's binding
// (server/plugins/loader.ts). Only the chain differs: a built-in's ships with the app and resolves from
// the module that declared it, a loaded package's is confined to its own directory by its manifest.
//
// Lazy, like the loader's. Nothing touches the filesystem until the plugin's init calls open(), so
// the host can build this for every plugin in the graph and a disabled plugin creates no database.
export function builtinPluginStorage(dataDir: string, plugin: string, moduleUrl: string): PluginStorage {
  // A module URL, not a directory, because the ancestor walk starts from the plugin's own module
  // (server/plugins/migrations.ts). Checked here because fileURLToPath otherwise throws a bare "Invalid
  // URL" that names no plugin.
  if (!moduleUrl.startsWith('file:')) {
    throw new Error(`Plugin '${plugin}' declares migrationsModule '${moduleUrl}'; it must be that module's own import.meta.url.`)
  }
  return { open: () => openPluginDb(dataDir, plugin, { migrationsFolder: pluginMigrationsFolder(plugin, moduleUrl) }) }
}
