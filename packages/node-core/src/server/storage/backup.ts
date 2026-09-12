import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { runProcess } from '../core/proc'
import { PLUGIN_DB_DIR } from '../plugins/storage'
import { resolveDatabasePath } from './paths'
import { openSqlite } from './sqlite'

// POST /v2/core/backup. docs/data-layer.md § Backup and import covers what is excluded and why.
// This is SQLite's online-backup API into a staging directory, a scrub, a manifest, and `tar`.
//
// Each database opens through a fresh readonly handle rather than the live one, because AppDatabase
// and PluginDatabase expose only `batch` and `close`, and threading every plugin's handle to
// `.backup()` would add a public method for one consumer. The online-backup API works from any
// handle to the same file and is safe against concurrent writers, which is why it beats `cp`.

export type BackupResult = {
  path: string
  bytes: number
  files: string[]
  excluded: string[]
}

const EXCLUDED = [
  'credentials (integrations.access_token)',
  'device tokens (the devices table)',
  'the TLS private key',
  'the session encryption key (session.key)',
  'the loopback internal token',
  'the blob cache (content-addressed, refetchable)',
  'worktrees (git checkouts, clone instead)',
]

// Copy one SQLite file with the online-backup API. Returns the destination path.
async function backupDatabase(source: string, destination: string): Promise<void> {
  // readonly stands in for better-sqlite3's `fileMustExist`. Opening a missing file read-only fails,
  // which is the same refusal by another route.
  const handle = openSqlite(source, { readonly: true })
  try {
    await handle.backup(destination)
  } finally {
    handle.close()
  }
}

// Remove the credential material from the copy, after the copy rather than by selecting columns,
// because the online-backup API copies a file and not a query. Copy-then-scrub leaves the source
// database untouched, which is what lets this run against a live node.
function scrubCore(copy: string): void {
  const handle = openSqlite(copy)
  try {
    // Blanked rather than deleted (docs/data-layer.md § Backup and import).
    handle.exec("UPDATE integrations SET access_token = ''")
    // Deleted outright, not blanked (docs/data-layer.md § Backup and import).
    handle.exec('DELETE FROM devices')
    // 24 hours of replay records for requests that can never be replayed against a new node.
    handle.exec('DELETE FROM idempotency')
    // Reclaims the pages those deletes freed, so a blanked token is not still sitting in one.
    //
    // Precautionary rather than proven here. backup.test.ts scans the raw archived bytes for the
    // ciphertext and passes with this line removed, because a database that small keeps the row in
    // place and close() checkpoints the WAL away. It earns its keep on a real data root, where an
    // UPDATE can relocate a row and leave the old page free.
    handle.exec('VACUUM')
  } finally {
    handle.close()
  }
}

// Every plugin database in the root, discovered rather than listed, so a plugin added later is
// backed up with no edit here.
function pluginDatabases(dataDir: string): string[] {
  try {
    return readdirSync(join(resolve(dataDir), PLUGIN_DB_DIR))
      .filter((name) => name.endsWith('.sqlite'))
      .sort()
  } catch {
    return [] // no plugins directory yet, so this node has never opened a plugin database
  }
}

// A destination the owner can accept or edit. In the node's home directory, not its data root: a
// backup written inside the thing it backs up disappears with it, and lands in the next backup. A
// second backup on the same day overwrites the first, which is what taking a snapshot again means.
export function suggestBackupPath(now = new Date()): string {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return join(homedir(), `acorn-backup-${day}.tar.gz`)
}

export async function createBackup(dataDir: string, destPath: string): Promise<BackupResult> {
  if (!isAbsolute(destPath)) throw new Error('The backup destination must be an absolute path.')
  const staging = mkdtempSync(join(tmpdir(), 'acorn-backup-'))
  try {
    const files: string[] = []
    const corePath = resolveDatabasePath(dataDir)
    const coreCopy = join(staging, basename(corePath))
    await backupDatabase(corePath, coreCopy)
    scrubCore(coreCopy)
    files.push(basename(corePath))

    for (const name of pluginDatabases(dataDir)) {
      await backupDatabase(join(resolve(dataDir), PLUGIN_DB_DIR, name), join(staging, name))
      files.push(name)
    }

    writeFileSync(
      join(staging, 'manifest.json'),
      // Name the exclusions in the archive itself. Someone restoring this in a year has the file
      // and not the release notes, and the archive should answer "where did my GitHub token go".
      `${JSON.stringify({ kind: 'acorn-backup', version: 1, createdAt: Date.now(), files, excluded: EXCLUDED }, null, 2)}\n`,
      { mode: 0o600 },
    )

    const result = await runProcess({
      file: '/usr/bin/tar',
      args: ['-czf', destPath, '-C', staging, '.'],
      cwd: dirname(destPath),
      timeoutMs: 10 * 60_000,
    })
    if (result.spawnError) throw new Error(`Could not run tar: ${result.spawnError}`)
    if (result.code !== 0) throw new Error(`tar failed (${result.code}): ${result.stderr.trim() || 'no output'}`)

    return { path: destPath, bytes: statSync(destPath).size, files, excluded: EXCLUDED }
  } finally {
    // The staging copy holds a core database that was briefly unscrubbed, so remove it whether or
    // not the archive was written.
    rmSync(staging, { recursive: true, force: true })
  }
}
