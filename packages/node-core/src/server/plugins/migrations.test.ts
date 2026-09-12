import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { openPluginDb } from './storage'
import { pluginMigrationsChain, pluginMigrationsFolder } from './migrations'

// The built layout puts a plugin's chain at out/migrations/<plugin>/ and core's at out/migrations/, one
// directory apart. These tests pin the resolver's plugin-scoped-first ordering.

const roots: string[] = []
const chain = (dir: string) => {
  mkdirSync(join(dir, 'meta'), { recursive: true })
  writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({ version: '6', dialect: 'sqlite', entries: [] }))
  return dir
}
const root = () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-plugin-migrations-'))
  roots.push(dir)
  return dir
}

const migrationChain = (dir: string, entries: Array<{ tag: string; when: number; sql: string }>) => {
  mkdirSync(join(dir, 'meta'), { recursive: true })
  writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({ version: '7', dialect: 'sqlite', entries }))
  for (const entry of entries) writeFileSync(join(dir, `${entry.tag}.sql`), entry.sql)
  return dir
}

describe('pluginMigrationsFolder', () => {
  afterEach(() => {
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('finds the plugin package chain in the source layout', () => {
    const dir = root()
    const expected = chain(join(dir, 'plugins/http/migrations'))
    const module = join(dir, 'plugins/http/src/node/migrations.ts')
    mkdirSync(join(dir, 'plugins/http/src/node'), { recursive: true })
    expect(pluginMigrationsFolder('http', pathToFileURL(module).href)).toBe(expected)
  })

  it('prefers the plugin-scoped chain over core’s in the built layout', () => {
    const dir = root()
    // The staged layout: scripts/stage.mjs puts service.js and the chains in one directory, core's at
    // `migrations` and each plugin's at `migrations/<id>`.
    const core = chain(join(dir, 'dist/helper/migrations'))
    const expected = chain(join(dir, 'dist/helper/migrations/http'))
    const module = join(dir, 'dist/helper/service.js')

    const resolved = pluginMigrationsFolder('http', pathToFileURL(module).href)
    expect(resolved).toBe(expected)
    expect(resolved).not.toBe(core)
  })

  it('throws rather than silently applying nothing when no chain exists', () => {
    const dir = root()
    const module = join(dir, 'dist/helper/service.js')
    mkdirSync(join(dir, 'dist/helper'), { recursive: true })
    // A `migrations` directory with no journal must not end the search either.
    mkdirSync(join(dir, 'dist/helper/migrations'), { recursive: true })
    expect(() => pluginMigrationsFolder('nosuch', pathToFileURL(module).href)).toThrow("No migrations chain found for plugin 'nosuch'")
  })

  it('stops at a plugin package root instead of adopting an ancestor chain', () => {
    const dir = root()
    chain(join(dir, 'migrations'))
    const module = join(dir, 'plugins/http/dist/node.js')
    mkdirSync(join(dir, 'plugins/http/dist'), { recursive: true })

    expect(() => pluginMigrationsFolder('http', pathToFileURL(module).href)).toThrow(/inside its package directory/)
  })

  it('validates an explicit manifest-resolved chain without searching', () => {
    const dir = root()
    const expected = chain(join(dir, 'package/db'))
    expect(pluginMigrationsChain('http', expected)).toBe(expected)
    expect(() => pluginMigrationsChain('http', join(dir, 'package/missing'))).toThrow(/declares migrations/)
  })
})

describe('applied plugin migration history', () => {
  afterEach(() => {
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  const first = { tag: '0000_first', when: 1_000, sql: 'CREATE TABLE first (id integer);' }
  const second = { tag: '0001_second', when: 2_000, sql: 'CREATE TABLE second (id integer);' }

  it('accepts the unchanged applied prefix and applies a new migration', () => {
    const dir = root()
    const migrations = migrationChain(join(dir, 'chain'), [first])
    openPluginDb(dir, 'history', { migrationsFolder: migrations }).close()
    migrationChain(migrations, [first, second])

    const db = openPluginDb(dir, 'history', { migrationsFolder: migrations })
    expect(db.$client.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'second'").get()).toBeTruthy()
    db.close()
  })

  it('refuses edited applied SQL without changing the database', () => {
    const dir = root()
    const migrations = migrationChain(join(dir, 'chain'), [first])
    openPluginDb(dir, 'history', { migrationsFolder: migrations }).close()
    migrationChain(migrations, [{ ...first, sql: `${first.sql}\nALTER TABLE first ADD COLUMN changed text;` }, second])

    expect(() => openPluginDb(dir, 'history', { migrationsFolder: migrations })).toThrow(/0000_first.*no longer matches/)
    const db = openPluginDb(dir, 'history', { migrationsFolder: migrationChain(migrations, [first]) })
    expect(db.$client.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'second'").get()).toBeUndefined()
    db.close()
  })

  it('refuses reordered applied journal entries without changing the database', () => {
    const dir = root()
    const migrations = migrationChain(join(dir, 'chain'), [first, second])
    openPluginDb(dir, 'history', { migrationsFolder: migrations }).close()
    migrationChain(migrations, [second, first])

    expect(() => openPluginDb(dir, 'history', { migrationsFolder: migrations })).toThrow(/0001_second.*no longer matches/)
    migrationChain(migrations, [first, second])
    const db = openPluginDb(dir, 'history', { migrationsFolder: migrations })
    expect(db.$client.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get()).toEqual({ count: 2 })
    db.close()
  })
})
