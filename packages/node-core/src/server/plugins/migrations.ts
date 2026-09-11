// Resolves a built-in plugin's Drizzle migration chain across the three runtime layouts
// (docs/data-layer.md § Migrations). The module URL passed in is always the plugin's own, never this
// file's, which stops a plugin from finding node-core's chain by proximity.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SqliteDatabase } from '../storage/sqlite'

// `resourcesPath` is a packaged-app addition to `process`. node-core compiles against plain Node
// types, so read it defensively rather than widening the package's types.
const resourcesPath = (process as { resourcesPath?: string }).resourcesPath

// `meta/_journal.json` rather than the directory alone: a chain without a journal silently applies
// nothing, so an unrelated `migrations` dir must not end the search.
const isChain = (dir: string): boolean => existsSync(join(dir, 'meta/_journal.json'))

export class PluginMigrationsError extends Error {
  override readonly name = 'PluginMigrationsError'
}

type JournalEntry = { tag: string; when: number }
type AppliedMigration = { hash: string; created_at: number }

const migrationJournal = (plugin: string, dir: string): JournalEntry[] => {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8'))
  } catch (error) {
    throw new PluginMigrationsError(`Plugin '${plugin}' has an unreadable migration journal: ${String(error)}`)
  }
  const entries = (parsed as { entries?: unknown })?.entries
  if (!Array.isArray(entries)) {
    throw new PluginMigrationsError(`Plugin '${plugin}' has an invalid migration journal: 'entries' must be an array.`)
  }
  return entries.map((entry, index) => {
    const tag = (entry as { tag?: unknown })?.tag
    const when = (entry as { when?: unknown })?.when
    if (typeof tag !== 'string' || !tag || typeof when !== 'number' || !Number.isFinite(when)) {
      throw new PluginMigrationsError(`Plugin '${plugin}' has an invalid migration journal entry at index ${index}.`)
    }
    return { tag, when }
  })
}

const expectedMigration = (plugin: string, dir: string, entry: JournalEntry): AppliedMigration => {
  const path = join(dir, `${entry.tag}.sql`)
  let sql: string
  try {
    sql = readFileSync(path, 'utf8')
  } catch {
    throw new PluginMigrationsError(`Plugin '${plugin}' migration '${entry.tag}' is missing from '${dir}'.`)
  }
  return { hash: createHash('sha256').update(sql).digest('hex'), created_at: entry.when }
}

/**
 * Refuse a migration chain whose already-applied prefix no longer describes the database.
 *
 * Drizzle's migrator records the hash and timestamp but only reads the newest timestamp before
 * applying more work. That makes an edited or reordered old entry invisible. Check every applied row
 * before handing the same handle to Drizzle, so a failed plugin update leaves the schema untouched.
 */
export function assertPluginMigrationHistory(
  plugin: string,
  dir: string,
  sqlite: Pick<SqliteDatabase, 'prepare'>,
): void {
  const table = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").get()
  if (!table) return

  let applied: AppliedMigration[]
  try {
    applied = sqlite
      .prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY rowid ASC')
      .all() as AppliedMigration[]
  } catch (error) {
    throw new PluginMigrationsError(`Plugin '${plugin}' migration history could not be read: ${String(error)}`)
  }

  const journal = migrationJournal(plugin, dir)
  if (applied.length > journal.length) {
    throw new PluginMigrationsError(
      `Plugin '${plugin}' migration history has ${applied.length} applied entries, but the package contains only ${journal.length}. Restore the original migration chain and add a new migration.`,
    )
  }

  for (const [index, actual] of applied.entries()) {
    const entry = journal[index]
    const expected = expectedMigration(plugin, dir, entry)
    if (actual.hash === expected.hash && Number(actual.created_at) === expected.created_at) continue
    throw new PluginMigrationsError(
      `Plugin '${plugin}' migration '${entry.tag}' at applied index ${index} no longer matches this database. Restore the original SQL and journal order, then add a new migration.`,
    )
  }
}

/** Validate an already-confined, manifest-declared migration directory. */
export function pluginMigrationsChain(plugin: string, dir: string): string {
  if (!isChain(dir)) {
    throw new PluginMigrationsError(`Plugin '${plugin}' declares migrations at '${dir}', but no Drizzle migration chain exists there.`)
  }
  return dir
}

// Source packages and loaded packages both have a `plugins/<id>/...` shape. The walk below stops
// here, so a missing chain cannot adopt dataRoot/migrations, a checkout-level core chain, or any
// other ancestor's DDL (docs/data-layer.md § Migrations).
const pluginPackageRoot = (plugin: string, start: string): string | null => {
  let dir = start
  for (;;) {
    if (basename(dir) === plugin && basename(dirname(dir)) === 'plugins') return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function pluginMigrationsFolder(plugin: string, moduleUrl: string): string {
  const packaged = resourcesPath ? join(resourcesPath, 'migrations', plugin) : null
  if (packaged && isChain(packaged)) return packaged
  let dir = dirname(fileURLToPath(moduleUrl))
  const packageRoot = pluginPackageRoot(plugin, dir)
  for (;;) {
    // Plugin-scoped first (the built/staged layout), then the plugin package's own migrations folder.
    const scoped = join(dir, 'migrations', plugin)
    if (isChain(scoped)) return scoped
    const bare = join(dir, 'migrations')
    if (isChain(bare)) return bare
    if (dir === packageRoot) {
      throw new PluginMigrationsError(`No migrations chain found for plugin '${plugin}' inside its package directory '${packageRoot}'.`)
    }
    const parent = dirname(dir)
    if (parent === dir) {
      throw new PluginMigrationsError(`No migrations chain found for plugin '${plugin}' (searched ancestors of ${moduleUrl} and ${packaged ?? 'no packaged path'}).`)
    }
    dir = parent
  }
}
