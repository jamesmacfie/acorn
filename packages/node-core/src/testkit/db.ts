// Test-only helper: a real better-sqlite3 DB in a tmp dir with all Drizzle migrations applied.
//
// In testkit/ rather than server/routes/, where it and its two siblings used to live. It was never a
// route; it sat there because that is where it was first needed, and eleven packages then imported a
// test helper through a path that reads like production surface. The directory is the documentation
// now: every `@acorn/node-core/testkit/...` import says out loud that it is test scaffolding, and the
// arch suite fails one from a production file.
// Requires the Node ABI build of
// better-sqlite3 (`pnpm --filter @acorn/desktop node:rebuild`); vitest runs under plain Node.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../main/bindings'
import { SecretService } from '../main/core/secrets'
import { openPluginDb, type PluginDatabase } from '../main/pluginStorage'
import type { AppDatabase } from '../server/db'

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

// The secret-bearing half of a test `Env`. Two fields, always together: the raw key and the
// SecretService every credential read goes through
// (main/core/secrets.ts). A test that sets only one of them compiles and then fails at the first
// credential read, so they are minted as a pair here rather than spelled out at each mount site.
export function testSecretEnv(hexKey: string): { SESSION_ENC_KEY: string; SECRETS: SecretService } {
  return { SESSION_ENC_KEY: hexKey, SECRETS: new SecretService(hexKey) }
}

export type TestPluginDb = { db: PluginDatabase; dataDir: string; cleanup: () => void }

// A real per-plugin SQLite file in a temp data root, migrated with that plugin's own chain. The caller
// passes its migrations folder because core cannot import a plugin.
//
// Keeping the schemas separate ensures plugin tests exercise the same ownership boundary as production.
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
