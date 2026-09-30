import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openWorkerPluginDb } from './workerStorage'
import { openPluginDb } from './storage'

let root: string
let migrations: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'acorn-confined-sql-'))
  migrations = join(root, 'migrations')
  mkdirSync(join(migrations, 'meta'), { recursive: true })
  writeFileSync(join(migrations, 'meta/_journal.json'), JSON.stringify({ version: '7', dialect: 'sqlite', entries: [] }))
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

for (const carrier of ['worker', 'loader fallback'] as const) describe(`${carrier} loaded SQL confinement`, () => {
  const open = () => carrier === 'worker'
    ? openWorkerPluginDb(join(root, 'owned.sqlite'), 'owned', migrations)
    : openPluginDb(root, 'owned', { migrationsFolder: migrations, loaded: true })

  it('retains owning schema, nested transactions, and WAL while refusing file operations', () => {
    const peer = join(root, 'synthetic-peer.sqlite')
    writeFileSync(peer, 'synthetic peer contents')
    const db = open()
    try {
      const client = db.$client
      client.exec('CREATE TABLE records (id INTEGER)')
      client.transaction(() => client.transaction(() => client.prepare('INSERT INTO records VALUES (?)').run(1))())()
      expect(client.prepare('SELECT * FROM records').all()).toEqual([{ id: 1 }])
      expect(Object.values(client.prepare('PRAGMA journal_mode').get() as object)).toEqual(['wal'])
      expect(Object.values(client.prepare('PRAGMA temp_store').get() as object)).toEqual([2])
      const quotedPeer = peer.replaceAll("'", "''")
      expect(() => client.exec(`ATTACH DATABASE '${quotedPeer}' AS peer`)).toThrow(/not authorized/)
      expect(() => client.prepare('ATTACH DATABASE ? AS peer').run(peer)).toThrow(/not authorized/)
      // VACUUM INTO has its own regression: the native authorization event must stop export before
      // creating a file, rather than relying on a textual check for ATTACH in the statement.
      const exported = join(root, 'forbidden-export.sqlite')
      expect(() => client.exec(`VACUUM INTO '${exported.replaceAll("'", "''")}'`)).toThrow(/authorization|not authorized/)
      expect(existsSync(exported)).toBe(false)
      expect(() => client.pragma("temp_store_directory = '/tmp'")).toThrow(/not authorized/)
      expect(() => client.pragma('temp_store = FILE')).toThrow(/not authorized/)
      expect(() => client.prepare("SELECT * FROM pragma_temp_store_directory").all()).toThrow()
      expect(readFileSync(peer, 'utf8')).toBe('synthetic peer contents')
      expect(client).not.toHaveProperty('setAuthorizer')
      expect(client).not.toHaveProperty('loadExtension')
    } finally { db.close() }
  })

  it('authorizes migrations before executing their SQL', () => {
    const exported = join(root, 'migration-export.sqlite')
    writeFileSync(join(migrations, 'meta/_journal.json'), JSON.stringify({ version: '7', dialect: 'sqlite', entries: [
      { idx: 0, version: '6', when: 1, tag: '0000_confined', breakpoints: true },
    ] }))
    writeFileSync(join(migrations, '0000_confined.sql'), `ATTACH DATABASE '${exported.replaceAll("'", "''")}' AS forbidden`)
    let rejected: unknown
    try { open().close() } catch (error) { rejected = error }
    expect(rejected).toMatchObject({ cause: { message: expect.stringContaining('not authorized') } })
    expect(existsSync(exported)).toBe(false)
  })

  it('applies an ordinary plugin migration with the policy already active', () => {
    writeFileSync(join(migrations, 'meta/_journal.json'), JSON.stringify({ version: '7', dialect: 'sqlite', entries: [
      { idx: 0, version: '6', when: 1, tag: '0000_owned', breakpoints: true },
    ] }))
    writeFileSync(join(migrations, '0000_owned.sql'), 'CREATE TABLE migrated (id INTEGER);\n--> statement-breakpoint\nINSERT INTO migrated VALUES (7)')
    const db = open()
    try { expect(db.$client.prepare('SELECT * FROM migrated').all()).toEqual([{ id: 7 }]) }
    finally { db.close() }
  })

  it('fails closed when native authorization is unavailable and closes the handle', () => {
    vi.spyOn(DatabaseSync.prototype, 'setAuthorizer')
    Object.defineProperty(DatabaseSync.prototype, 'setAuthorizer', { value: undefined, configurable: true })
    const close = vi.spyOn(DatabaseSync.prototype, 'close')
    expect(open).toThrow('Loaded plugin storage requires SQLite authorization support')
    expect(close).toHaveBeenCalledOnce()
  })
})

it('refuses arbitrary backup destinations on the loader fallback without creating a file', async () => {
  const db = openPluginDb(root, 'owned', { migrationsFolder: migrations, loaded: true })
  const exported = join(root, 'backup-export.sqlite')
  try {
    await expect(db.$client.backup(exported)).rejects.toThrow('cannot export database files')
    expect(existsSync(exported)).toBe(false)
  } finally { db.close() }
})
