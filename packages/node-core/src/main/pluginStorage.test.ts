import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PLUGIN_DB_DIR, openPluginDb } from './pluginStorage'

// The per-plugin database factory has 10+ production consumers and had no direct test — every plugin's
// storage goes through it, and it was covered only incidentally by integration suites.
describe('plugin storage', () => {
  let dir: string
  let migrations: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-plugin-db-'))
    // A migrations folder with an EMPTY journal: this suite is about the file the factory opens and the
    // shape of the directory it opens it in, not about any one plugin's schema. Drizzle's migrator
    // still insists on a readable journal, so it gets one with nothing in it.
    migrations = join(dir, 'migrations')
    mkdirSync(join(migrations, 'meta'), { recursive: true })
    writeFileSync(join(migrations, 'meta', '_journal.json'), JSON.stringify({ version: '7', dialect: 'sqlite', entries: [] }))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('puts every plugin database under one directory, named for its plugin', () => {
    const db = openPluginDb(dir, 'widgets', { migrationsFolder: migrations })
    try {
      expect(existsSync(join(dir, PLUGIN_DB_DIR, 'widgets.sqlite'))).toBe(true)
    } finally {
      db.close()
    }
  })

  // Two plugins must never share a file. Their schemas are independent and migrate independently, so a
  // collision would migrate one plugin's tables into the other's database.
  it('gives two plugins two files', () => {
    const a = openPluginDb(dir, 'alpha', { migrationsFolder: migrations })
    const b = openPluginDb(dir, 'beta', { migrationsFolder: migrations })
    try {
      expect(existsSync(join(dir, PLUGIN_DB_DIR, 'alpha.sqlite'))).toBe(true)
      expect(existsSync(join(dir, PLUGIN_DB_DIR, 'beta.sqlite'))).toBe(true)
    } finally {
      a.close()
      b.close()
    }
  })

  // WAL mode is what lets the node read while a plugin writes, and it is also why every handle has to be
  // closed before the data root's lock is dropped (the composition roots' teardown invariant).
  // The id becomes a filename, so a bad one has to be refused rather than written.
  it('refuses a plugin id that is not a safe filename', () => {
    for (const bad of ['../escape', 'Widgets', '', 'with space']) {
      expect(() => openPluginDb(dir, bad, { migrationsFolder: migrations })).toThrow(/Plugin database id/)
    }
  })

  it('opens in WAL mode', () => {
    const db = openPluginDb(dir, 'widgets', { migrationsFolder: migrations })
    try {
      const [mode] = Object.values(db.$client.prepare('PRAGMA journal_mode').get() as Record<string, unknown>)
      expect(String(mode).toLowerCase()).toBe('wal')
    } finally {
      db.close()
    }
  })
})
