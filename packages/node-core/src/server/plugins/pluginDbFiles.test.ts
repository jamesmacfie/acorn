import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openPluginDb, preparePluginDbFiles } from './storage'
import { openWorkerPluginDb } from './workerStorage'

let root: string
let migrations: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'acorn-state-preflight-'))
  migrations = join(root, 'migrations')
  mkdirSync(join(migrations, 'meta'), { recursive: true })
  writeFileSync(join(migrations, 'meta/_journal.json'), JSON.stringify({ version: '7', dialect: 'sqlite', entries: [] }))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

for (const carrier of ['preparation', 'worker', 'loader fallback'] as const) describe(`${carrier} state-file preflight`, () => {
  const path = () => join(root, 'plugins', 'owned.sqlite')
  const open = () => {
    if (carrier === 'preparation') preparePluginDbFiles(root, 'owned')
    else if (carrier === 'worker') openWorkerPluginDb(path(), 'owned', migrations).close()
    else openPluginDb(root, 'owned', { migrationsFolder: migrations, loaded: true, prepared: true }).close()
  }

  it.each(['', '-wal', '-shm'])('refuses a linked %s state entry without touching the peer', (suffix) => {
    mkdirSync(join(root, 'plugins'))
    const peer = join(root, 'synthetic-peer')
    writeFileSync(peer, 'synthetic peer contents')
    chmodSync(peer, 0o644)
    symlinkSync(peer, path() + suffix)
    expect(open).toThrow('Plugin database state must be a regular file.')
    expect(readFileSync(peer, 'utf8')).toBe('synthetic peer contents')
    expect(statSync(peer).mode & 0o777).toBe(0o644)
    expect(lstatSync(path() + suffix).isSymbolicLink()).toBe(true)
  })

  it('refuses a FIFO without waiting for a writer', () => {
    mkdirSync(join(root, 'plugins'))
    execFileSync('mkfifo', [path() + '-wal'])
    expect(open).toThrow('Plugin database state must be a regular file.')
    expect(lstatSync(path() + '-wal').isFIFO()).toBe(true)
  })

  it('refuses a directory state entry without removing it', () => {
    mkdirSync(path() + '-shm', { recursive: true })
    expect(open).toThrow(/regular file|EISDIR/)
    expect(lstatSync(path() + '-shm').isDirectory()).toBe(true)
  })
})

it('refuses a linked plugins directory without creating files or chmodding its target', () => {
  const peer = join(root, 'synthetic-directory')
  mkdirSync(peer, { mode: 0o755 })
  chmodSync(peer, 0o755)
  symlinkSync(peer, join(root, 'plugins'))
  expect(() => preparePluginDbFiles(root, 'owned')).toThrow()
  expect(existsSync(join(peer, 'owned.sqlite'))).toBe(false)
  expect(statSync(peer).mode & 0o777).toBe(0o755)
})

it('supports a data-root alias and secures regular state files by descriptor', () => {
  const alias = join(root, 'root-alias')
  symlinkSync(root, alias)
  const paths = preparePluginDbFiles(alias, 'owned')
  for (const path of paths) {
    expect(lstatSync(path).isFile()).toBe(true)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    chmodSync(path, 0o644)
  }
  preparePluginDbFiles(alias, 'owned')
  expect(paths.every((path) => (statSync(path).mode & 0o777) === 0o600)).toBe(true)
  const db = openPluginDb(alias, 'owned', { migrationsFolder: migrations, loaded: true })
  try { expect(db.$client.prepare('SELECT 1 AS ok').get()).toEqual({ ok: 1 }) }
  finally { db.close() }
})

it('allows native opens to create a database and missing sidecars', () => {
  mkdirSync(join(root, 'plugins'))
  for (const carrier of ['worker', 'loader fallback'] as const) {
    const path = join(root, 'plugins', `${carrier === 'worker' ? 'worker' : 'fallback'}.sqlite`)
    const db = carrier === 'worker'
      ? openWorkerPluginDb(path, 'owned', migrations)
      : openPluginDb(root, 'fallback', { migrationsFolder: migrations, loaded: true, prepared: true })
    try { expect(db.$client.prepare('SELECT 1 AS ok').get()).toEqual({ ok: 1 }) }
    finally { db.close() }
  }
})
