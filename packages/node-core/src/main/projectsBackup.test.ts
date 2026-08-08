import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadDatabase } from './sqliteLoader'
import { openDb } from './bindings'

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations')
const journal = (JSON.parse(readFileSync(join(migrationsDir, 'meta/_journal.json'), 'utf8')) as { entries: { idx: number; tag: string; when: number }[] }).entries.sort(
  (a, b) => a.idx - b.idx,
)

const applyMigration = (db: InstanceType<ReturnType<typeof loadDatabase>>, tag: string) => {
  const sql = readFileSync(join(migrationsDir, `${tag}.sql`), 'utf8')
  for (const statement of sql.split('--> statement-breakpoint')) {
    const trimmed = statement.trim()
    if (trimmed) db.exec(trimmed)
  }
}

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`

const legacyProjectTable = (db: InstanceType<ReturnType<typeof loadDatabase>>): string => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
  const match = tables.find(({ name }) => {
    const columns = db.prepare(`PRAGMA table_info(${quoteIdentifier(name)})`).all() as { name: string }[]
    const names = new Set(columns.map((column) => column.name))
    return names.has('owner') && names.has('repo') && names.has('path')
  })
  if (!match) throw new Error('Legacy project table was not created by the historical migrations.')
  return quoteIdentifier(match.name)
}

describe('pre-projects database backup', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'acorn-projects-backup-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('copies the legacy database once, privately, before migration 0046', () => {
    const databasePath = join(root, 'core.sqlite')
    const Database = loadDatabase()
    const seed = new Database(databasePath)
    for (const entry of journal.filter((item) => item.idx < 46)) applyMigration(seed, entry.tag)
    const latestLegacyMigration = journal.find((item) => item.idx === 45)!
    seed.exec('CREATE TABLE "__drizzle_migrations" (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)')
    seed.prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)').run('phase1-test', latestLegacyMigration.when)
    const legacyTable = legacyProjectTable(seed)
    seed.exec(`INSERT INTO ${legacyTable} (owner, repo, path, created_at, updated_at) VALUES ('acme', 'web', '/checkouts/web', 1, 1)`)
    seed.close()

    const db = openDb(databasePath)
    db.close()

    const backupPath = `${databasePath}.pre-projects.bak`
    expect(existsSync(backupPath)).toBe(true)
    expect(statSync(backupPath).mode & 0o777).toBe(0o600)

    const backup = new Database(backupPath, { readonly: true, fileMustExist: true })
    expect(backup.prepare(`SELECT owner, repo, path FROM ${legacyTable}`).get()).toEqual({ owner: 'acme', repo: 'web', path: '/checkouts/web' })
    backup.close()

    const firstBackup = readFileSync(backupPath)
    const destructiveBackups = readdirSync(root).filter((name) => name.startsWith('core.sqlite.pre-legacy-drop-') && name.endsWith('.bak'))
    expect(destructiveBackups).toHaveLength(1)
    const destructiveBackupPath = join(root, destructiveBackups[0])
    expect(statSync(destructiveBackupPath).mode & 0o777).toBe(0o600)
    const legacyDropBackup = new Database(destructiveBackupPath, { readonly: true, fileMustExist: true })
    expect(legacyDropBackup.prepare(`SELECT owner, repo, path FROM ${legacyTable}`).get()).toEqual({ owner: 'acme', repo: 'web', path: '/checkouts/web' })
    legacyDropBackup.close()
    const reopened = openDb(databasePath)
    reopened.close()
    expect(readFileSync(backupPath)).toEqual(firstBackup)
  })
})
