import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { runProcess } from './core/proc'
import { PLUGIN_DB_DIR } from './pluginStorage'
import { resolveDatabasePath } from './serverPaths'
import { loadDatabase } from './sqliteLoader'

// `POST /v2/core/backup` (docs/data-layer.md § Backup). The spec's own words are "keep it boring", and
// this is that: SQLite's online-backup API into a staging directory, a scrub, a manifest, and `tar`.
//
// ## What is in it, and what is deliberately not
//
// IN: core.sqlite and every plugins/*.sqlite. Those hold the workspace/task model, repo configuration,
// agent transcripts, notes, memories and the HTTP client's saved requests — the things a person would be
// upset to lose and cannot reconstruct from GitHub.
//
// OUT, and each for its own reason:
//
//   - **Secrets.** `integrations.access_token` is a JWE blob, so an archive that carried it would be
//     decryptable by anyone who also had the key — and the key is exactly what a backup travelling to a
//     NAS or a cloud drive is most likely to end up beside. docs/data-layer.md is explicit: "restoring credentials
//     from a file that might travel is exactly the risk we don't want."
//   - **Device tokens.** Same argument, one step worse: a `devices` row's hash plus a stolen archive is
//     an offline guessing target for a credential with full owner authority.
//   - **The TLS key and the internal token.** Files in the data root, never copied here at all.
//   - **Blobs.** Not a risk — a size decision. The blob store is content-addressed cache: patches and
//     file bodies re-fetchable from GitHub, and it is routinely the largest thing in a data root. A
//     backup that is ten times bigger and no more recoverable is a backup people stop taking.
//   - **Worktrees.** They are git checkouts with remotes; `git clone` is the restore.
//
// ## Why a fresh readonly handle per file rather than the live one
//
// `AppDatabase` and `PluginDatabase` deliberately expose only `batch` and `close` — the raw
// better-sqlite3 handle is not reachable from a caller, and threading every plugin's handle through the
// route to get at `.backup()` would mean giving every plugin's storage a new public method for one
// consumer. SQLite's online-backup API works from any handle to the same file, including a readonly one,
// and it is safe against concurrent writers by design: that is the entire point of it over `cp`.

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
  'the loopback internal token',
  'the blob cache (content-addressed, refetchable)',
  'worktrees (git checkouts — clone instead)',
]

// Copy one SQLite file with the online-backup API. Returns the destination path.
async function backupDatabase(source: string, destination: string): Promise<void> {
  const Database = loadDatabase()
  const handle = new Database(source, { readonly: true, fileMustExist: true })
  try {
    await handle.backup(destination)
  } finally {
    handle.close()
  }
}

// Remove the credential material from the COPY. Done after the copy rather than by selecting columns,
// because the online-backup API copies a file rather than a query — and doing it as a copy-then-scrub
// keeps the source database untouched, which is the property that lets this run against a live node.
function scrubCore(copy: string): void {
  const Database = loadDatabase()
  const handle = new Database(copy)
  try {
    // Blanked rather than deleted: a restored node should still show that a Linear connection existed
    // and needs re-entering, which is the state docs/data-layer.md describes ("secrets and pairings are
    // re-entered"). A deleted row would silently lose the workspace links that point at it.
    handle.exec("UPDATE integrations SET access_token = ''")
    // Deleted rather than blanked: a device row IS its credential's public half, and a restored node
    // must re-pair. Keeping revoked-looking rows would be a list of machines that no longer have access,
    // which is worse than an empty list.
    handle.exec('DELETE FROM devices')
    // 24 hours of replay records for requests that can never be replayed against a new node.
    handle.exec('DELETE FROM idempotency')
    // Reclaims the pages those deletes freed, so a blanked token is not still sitting in one.
    //
    // PRECAUTIONARY, and labelled as such rather than claimed: backup.test.ts scans the raw archived
    // bytes for the ciphertext and passes with this line REMOVED, because a database this small keeps
    // the row in place and better-sqlite3's close() checkpoints the WAL away. It earns its keep on a
    // real data root, where an UPDATE can relocate a row and leave the old page free. Cheap insurance
    // against a case a test at this size cannot construct.
    handle.exec('VACUUM')
  } finally {
    handle.close()
  }
}

// Every plugin database in the root, discovered rather than listed. main/pluginStorage.ts's header says
// the directory exists precisely so a backup can enumerate it without knowing the plugin list — this is
// the first caller to take it up on that, and it means a plugin added later is backed up with no edit
// here.
function pluginDatabases(dataDir: string): string[] {
  try {
    return readdirSync(join(resolve(dataDir), PLUGIN_DB_DIR))
      .filter((name) => name.endsWith('.sqlite'))
      .sort()
  } catch {
    return [] // no plugins directory yet — a node that has never opened a plugin database
  }
}

// A destination the owner can accept or edit. In the node's HOME, not its data root: a backup written
// inside the thing it is backing up is one that goes away with it, and is also one the next backup
// includes. The date is enough to disambiguate — a second backup on the same day overwrites the first,
// which is what someone taking a manual snapshot means by "back it up again".
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
      // The exclusions are IN the archive, not only in the docs. Someone restoring this in a year will
      // have the file and not the release notes, and "why is my GitHub token gone" is a question the
      // archive itself should answer.
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
    // The staging copy holds an unscrubbed-for-one-moment core database, so it is removed whether or not
    // the archive was written.
    rmSync(staging, { recursive: true, force: true })
  }
}
