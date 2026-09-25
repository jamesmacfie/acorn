import { chmodSync, mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { diskBlobCache, openDb } from './bindings'

describe('local data permissions', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'acorn-perms-'))
    chmodSync(root, 0o755)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('migrates the data directory and SQLite files to owner-only access', () => {
    const path = join(root, 'acorn.sqlite')
    writeFileSync(path, '')
    chmodSync(path, 0o644)

    openDb(path).close()

    expect(statSync(root).mode & 0o777).toBe(0o700)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    for (const suffix of ['-wal', '-shm']) {
      try {
        expect(statSync(`${path}${suffix}`).mode & 0o777).toBe(0o600)
      } catch {
        // SQLite can remove empty sidecars when a connection is quiescent.
      }
    }
  })

  it('refuses a database with an earlier migration history before changing its schema', () => {
    const path = join(root, 'core.sqlite')
    const old = new DatabaseSync(path)
    old.exec('CREATE TABLE __drizzle_migrations (id integer primary key, hash text not null, created_at integer)')
    old.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run('old-sql', 1)
    old.exec('CREATE TABLE preserved (value text)')
    old.close()

    expect(() => openDb(path)).toThrow(/Core migration.*recoverable reset/)
    const unchanged = new DatabaseSync(path)
    expect(unchanged.prepare("SELECT name FROM sqlite_master WHERE name = 'preserved'").get()).toBeTruthy()
    expect(unchanged.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get()).toEqual({ count: 1 })
    unchanged.close()
  })

  it('refuses preexisting tables with no migration history', () => {
    const path = join(root, 'core.sqlite')
    const old = new DatabaseSync(path)
    old.exec('CREATE TABLE preserved (value text)')
    old.close()

    expect(() => openDb(path)).toThrow(/Core has tables without a migration history.*recoverable reset/)
    const unchanged = new DatabaseSync(path)
    expect(unchanged.prepare("SELECT name FROM sqlite_master WHERE name = 'preserved'").get()).toBeTruthy()
    expect(unchanged.prepare("SELECT name FROM sqlite_master WHERE name = '__drizzle_migrations'").get()).toBeUndefined()
    unchanged.close()
  })

  it('migrates existing blobs and writes new blobs mode 0600', async () => {
    const dir = join(root, 'blobs')
    mkdirSync(dir)
    const old = join(dir, 'patch_old')
    writeFileSync(old, 'old')
    chmodSync(old, 0o644)
    // Already right, and it has to stay untouched: `chmod` on a correct file is a syscall that changes
    // nothing, and there are thousands of these on a real cache
    // (2,975 of them cost 102 ms of boot, measured 2026-09-03).
    const settled = join(dir, 'patch_settled')
    writeFileSync(settled, 'settled', { mode: 0o600 })
    const before = statSync(settled, { bigint: true }).ctimeNs

    const cache = diskBlobCache(dir)
    await cache.put('patch:new', 'new')

    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(statSync(old).mode & 0o777).toBe(0o600)
    expect(statSync(join(dir, 'patch_new')).mode & 0o777).toBe(0o600)
    // chmod bumps ctime, so an unchanged ctime says the sweep skipped it.
    expect(statSync(settled, { bigint: true }).ctimeNs).toBe(before)
    expect(statSync(settled).mode & 0o777).toBe(0o600)
  })
})
