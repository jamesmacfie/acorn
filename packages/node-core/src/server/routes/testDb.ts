// Test-only helper: a real better-sqlite3 DB in a tmp dir with all Drizzle migrations applied —
// the plan's pattern for DB-shape-critical route tests. Requires the Node ABI build of
// better-sqlite3 (`pnpm --filter @acorn/desktop node:rebuild`); vitest runs under plain Node.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../../main/bindings'
import { SecretService } from '../../main/core/secrets'
import { openPluginDb, type PluginDatabase } from '../../main/pluginStorage'
import type { AppDatabase } from '../db'

export type TestDb = { db: AppDatabase; cleanup: () => void }

export function makeTestDb(): TestDb {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-test-'))
  const db = openDb(join(dir, 'test.sqlite'))
  return {
    db,
    cleanup: () => {
      try {
        db.close()
      } catch {
        // A test may have exercised explicit runtime shutdown already.
      }
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // best-effort — tmpdir is reaped by the OS anyway
      }
    },
  }
}

// The secret-bearing half of a test `Env`. Two fields, always together: the raw key (still read by the
// legacy HTTP-storage migration) and the SecretService every credential read now goes through
// (main/core/secrets.ts). A test that sets only one of them compiles and then fails at the first
// credential read, so they are minted as a pair here rather than spelled out at each mount site.
export function testSecretEnv(hexKey: string): { SESSION_ENC_KEY: string; SECRETS: SecretService } {
  return { SESSION_ENC_KEY: hexKey, SECRETS: new SecretService(hexKey) }
}

export type TestPluginDb = { db: PluginDatabase; dataDir: string; cleanup: () => void }

// A real per-plugin SQLite file in a temp data root, migrated with that plugin's OWN chain — the
// plugin-side counterpart of makeTestDb. The caller passes its migrations folder because core cannot
// import a plugin (main/pluginStorage.ts).
//
// Deliberately not "makeTestDb with extra tables": a plugin test that could see core's schema would
// keep passing after the plugin started reading a table it no longer owns, which is exactly the
// coupling the split removes.
export function makeTestPluginDb(plugin: string, migrationsFolder: string): TestPluginDb {
  const dataDir = mkdtempSync(join(tmpdir(), `acorn-test-${plugin}-`))
  const db = openPluginDb(dataDir, plugin, { migrationsFolder })
  return {
    db,
    dataDir,
    cleanup: () => {
      try {
        db.close()
      } catch {
        // A test may have closed it already.
      }
      try {
        rmSync(dataDir, { recursive: true, force: true })
      } catch {
        // best-effort — tmpdir is reaped by the OS anyway
      }
    },
  }
}
