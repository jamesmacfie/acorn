import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PLUGIN_DB_DIR, openPluginDb } from './storage'

// The per-plugin database factory has ten-plus production consumers and had no direct test: every
// plugin's storage goes through it, covered only incidentally by integration suites.
describe('plugin storage', () => {
  let dir: string
  let migrations: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-plugin-db-'))
    // A migrations folder with an empty journal. This suite is about the file the factory opens and the
    // shape of the directory it opens it in, not any one plugin's schema, but Drizzle's migrator still
    // insists on a readable journal.
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

  // WAL mode is what lets the node read while a plugin writes, and it's also why every handle has to be
  // closed before the data root's lock is dropped. The id becomes a filename, so a bad one is refused
  // rather than written.
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

  // Opening and closing a database file with node:fs after SQLite opens it drops this process's
  // locks on that file. Another process then resets the -shm file under this process's memory map,
  // and the node dies with SIGBUS. Asking for exclusive access from a second process detects the
  // dropped lock without risking that crash in the test runner.
  // The second open is a reload: the candidate opens its handle while the previous instance still
  // holds one, so the preflight runs against a live database.
  it('keeps its file locks once open, including through a reload', () => {
    const db = openPluginDb(dir, 'widgets', { migrationsFolder: migrations })
    openPluginDb(dir, 'widgets', { migrationsFolder: migrations }).close()
    try {
      const path = join(dir, PLUGIN_DB_DIR, 'widgets.sqlite')
      const probe = spawnSync(process.execPath, ['-e', `
        const db = new (require('node:sqlite').DatabaseSync)(${JSON.stringify(path)})
        db.exec('PRAGMA locking_mode = EXCLUSIVE')
        try { db.prepare('SELECT 1 FROM sqlite_master').all(); console.log('exclusive') }
        catch (error) { console.log(error.message) }`], { encoding: 'utf8' })
      expect(probe.stdout.trim()).toBe('database is locked')
    } finally {
      db.close()
    }
  })
})
