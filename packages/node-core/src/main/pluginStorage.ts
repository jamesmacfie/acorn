// Per-plugin SQLite (docs/vNext/data.md § Plugin DBs: "Each plugin gets its own SQLite file, opened
// and migrated by core's storage service at plugin init. The plugin owns its schema and its Drizzle
// migration chain.").
//
// Two reasons this is a separate function rather than a parameter on openDb:
//
//   1. Core cannot import a plugin's schema — @acorn/node-core is a lib, and a lib importing a plugin
//      is a boundary violation (tools/arch/boundaries.test.ts rule 6). So the plugin supplies its own
//      schema and migrations folder and core supplies the file, the hardening and the migration run.
//   2. The handle goes to the plugin as `ctx.db`, NOT onto `Env`. `c.env` reaches every core and
//      plugin route (main/bindings.ts), so a per-plugin DB there would be readable by all of them,
//      which is the coupling the split exists to remove.
//
// data.md forbids cross-DB queries, ATTACH, and transactions spanning files. Cross-plugin references
// are plain IDs, dereferenced through the owning plugin.
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { loadDatabase } from './sqliteLoader'

// One directory for every plugin DB, so a backup can enumerate them without knowing the plugin list
// (data.md § Backup) and so `plugins/` is visibly separate from core.sqlite in a data root.
export const PLUGIN_DB_DIR = 'plugins'

const PLUGIN_ID_RE = /^[a-z][a-z0-9-]*$/

export type PluginDatabase = ReturnType<typeof drizzle> & {
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

  const Database = loadDatabase()
  const sqlite = new Database(databasePath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('busy_timeout = 5000')

  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder: options.migrationsFolder })
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (existsSync(path)) chmodSync(path, 0o600)
  }

  const withBatch = db as unknown as PluginDatabase
  // `.batch([...])` as a synchronous transaction, matching openDb. It is all-or-nothing WITHIN this
  // file only — data.md is explicit that a transaction never spans databases.
  withBatch.batch = (async (statements: ReadonlyArray<{ run(): unknown }>) =>
    db.transaction((_tx) => statements.map((stmt) => stmt.run()))) as PluginDatabase['batch']
  withBatch.close = () => sqlite.close()
  return withBatch
}
