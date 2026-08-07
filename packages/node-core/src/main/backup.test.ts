import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBackup, suggestBackupPath } from './backup'
import { openDb } from './bindings'
import { PLUGIN_DB_DIR } from './pluginStorage'
import { loadDatabase } from './sqliteLoader'
import { schema } from '../server/db'

// The backup, against a REAL data root and unpacked with the real `tar` (docs/vNext/data.md § Backup).
//
// The archive is the deliverable, so the assertions are about what comes back OUT of it. A test that
// checked the staging directory would prove the copy and not the thing an owner actually restores from —
// and the exclusions, which are the security-relevant half, are only observable in the copy.

let root: string
let out: string

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'acorn-backup-src-'))
  out = mkdtempSync(join(tmpdir(), 'acorn-backup-out-'))
  // A real migrated core database with a credential and a device in it — the two things that must not
  // survive the trip.
  const db = openDb(join(root, 'core.sqlite'))
  const now = Date.now()
  await db.insert(schema.integrations).values({
    id: 'conn-1',
    userId: 'james',
    provider: 'linear',
    label: 'Linear – work',
    authRef: 'SUPER-SECRET-CIPHERTEXT',
    authKind: 'api-key',
    account: null,
    scopes: '[]',
    capabilities: '{}',
    config: '{}',
    status: 'connected',
    lastValidatedAt: now,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(schema.devices).values({
    id: 'device-1',
    name: "James's laptop",
    secretHash: Buffer.alloc(32, 7),
    createdAt: now,
    lastSeenAt: null,
    revokedAt: null,
  })
  // A workspace, so there is something the backup is FOR — an archive that excluded everything would
  // pass the exclusion assertions perfectly.
  await db.insert(schema.workspaces).values({
    id: 'ws-1',
    name: 'Runn',
    isDefault: true,
    sort: 0,
    icon: null,
    color: null,
    createdAt: now,
    updatedAt: now,
  })
  db.close()

  // Two plugin databases, DISCOVERED rather than named: pluginStorage's header says the directory exists
  // so a backup can enumerate it without knowing the plugin list, and this is what tests that claim.
  mkdirSync(join(root, PLUGIN_DB_DIR), { recursive: true })
  const Database = loadDatabase()
  for (const name of ['agents', 'notes']) {
    const handle = new Database(join(root, PLUGIN_DB_DIR, `${name}.sqlite`))
    handle.exec('CREATE TABLE thing (id TEXT PRIMARY KEY)')
    handle.exec(`INSERT INTO thing VALUES ('${name}-row')`)
    handle.close()
  }
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(out, { recursive: true, force: true })
})

// Unpack with the same tool an owner would, into a fresh directory.
function unpack(archive: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-backup-unpack-'))
  execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', dir])
  return dir
}

describe('createBackup', () => {
  it('archives core and every plugin database, and they open', async () => {
    const archive = join(out, 'backup.tar.gz')
    const result = await createBackup(root, archive)

    expect(result.files).toEqual(['core.sqlite', 'agents.sqlite', 'notes.sqlite'])
    expect(result.bytes).toBeGreaterThan(0)

    const dir = unpack(archive)
    try {
      expect(readdirSync(dir).sort()).toEqual(['agents.sqlite', 'core.sqlite', 'manifest.json', 'notes.sqlite'])
      const Database = loadDatabase()
      // Openable and populated, not merely present: a zero-byte file would satisfy a listing.
      const agents = new Database(join(dir, 'agents.sqlite'), { readonly: true })
      expect(agents.prepare('SELECT id FROM thing').all()).toEqual([{ id: 'agents-row' }])
      agents.close()
      const core = new Database(join(dir, 'core.sqlite'), { readonly: true })
      expect(core.prepare('SELECT name FROM workspaces').all()).toEqual([{ name: 'Runn' }])
      core.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('carries no credential and no device token', async () => {
    const archive = join(out, 'backup.tar.gz')
    await createBackup(root, archive)
    const dir = unpack(archive)
    try {
      const Database = loadDatabase()
      const core = new Database(join(dir, 'core.sqlite'), { readonly: true })
      // Blanked rather than deleted, so a restored node still shows that a Linear connection existed and
      // needs re-entering — which is the state data.md describes.
      expect(core.prepare('SELECT access_token, label FROM integrations').all()).toEqual([
        { access_token: '', label: 'Linear – work' },
      ])
      // Deleted outright: a device row IS its credential's public half, and a restored node must re-pair.
      expect(core.prepare('SELECT count(*) AS n FROM devices').get()).toEqual({ n: 0 })
      core.close()

      // The strongest form of the assertion: the ciphertext must not be anywhere in the file, including
      // a freed page. Scanned over the raw bytes rather than through SQL.
      //
      // Note what this does NOT prove. It passes with the VACUUM removed — a database this small keeps
      // the row in place and better-sqlite3's close() checkpoints the WAL away — so the VACUUM is
      // precautionary for a real data root, not something covered here. Recorded rather than implied.
      expect(readFileSync(join(dir, 'core.sqlite')).includes('SUPER-SECRET-CIPHERTEXT')).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes a manifest that says what was left out', async () => {
    const archive = join(out, 'backup.tar.gz')
    await createBackup(root, archive)
    const dir = unpack(archive)
    try {
      const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
        kind: string
        files: string[]
        excluded: string[]
      }
      // In the archive, not only in the docs: whoever restores this in a year has the file and not the
      // release notes, and "why is my GitHub token gone" is a question the archive should answer.
      expect(manifest.kind).toBe('acorn-backup')
      expect(manifest.files).toContain('core.sqlite')
      expect(manifest.excluded.join(' ')).toMatch(/credential/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('leaves the source databases untouched', async () => {
    const before = readFileSync(join(root, 'core.sqlite'))
    await createBackup(root, join(out, 'backup.tar.gz'))
    // The scrub runs on the COPY. Getting this backwards would blank the owner's live credentials as a
    // side effect of taking a backup, which is the worst possible failure this file could have.
    expect(readFileSync(join(root, 'core.sqlite')).equals(before)).toBe(true)
  })

  it('refuses a relative destination', async () => {
    await expect(createBackup(root, 'backup.tar.gz')).rejects.toThrow(/absolute/)
  })
})

describe('suggestBackupPath', () => {
  it('suggests a dated archive in the home directory, not in the data root', () => {
    const path = suggestBackupPath(new Date(2026, 7, 7))
    expect(path).toMatch(/acorn-backup-2026-08-07\.tar\.gz$/)
    // A backup written inside the thing it is backing up goes away with it, and is also included by the
    // next one.
    expect(path).not.toContain('.acorn')
  })
})
