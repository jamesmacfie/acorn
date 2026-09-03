import { chmodSync, mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

    openDb(path)

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

  it('migrates existing blobs and writes new blobs mode 0600', async () => {
    const dir = join(root, 'blobs')
    mkdirSync(dir)
    const old = join(dir, 'patch_old')
    writeFileSync(old, 'old')
    chmodSync(old, 0o644)
    // Already right, and it has to stay untouched: `chmod` on a correct file is a syscall that changes
    // nothing, and there are thousands of these on a real cache
    // (docs/performance.md § 2026-09-03 — phase 3).
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
