// Test-only helper: a real SQLite DB (node:sqlite, server/storage/sqlite.ts) in a tmp dir with all Drizzle
// migrations applied, no native build to match whichever runtime hosts the tests. See
// docs/testing.md § Testkit for why this lives in its own directory.
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb, type Env } from '../server/bindings'
import { SecretService } from '../server/core/secrets'
import { openPluginDb, type PluginDatabase } from '../server/plugins/storage'
import type { AppDatabase } from '../server/db'

export type TestDb = { db: AppDatabase; secrets: SecretService; cleanup: () => void }

export function makeTestDb(): TestDb {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-test-'))
  const db = openDb(join(dir, 'test.sqlite'))
  return {
    db,
    // The same binding `testEnv` puts on `c.env`, minted from the same key, for the node-side callers
    // that take a SecretService directly instead of a request context.
    secrets: new SecretService(TEST_ENCRYPTION_KEY),
    cleanup: () => {
      try {
        db.close()
      } catch {
        // A test may have exercised explicit runtime shutdown already.
      }
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // Best effort. The OS reaps tmpdir anyway.
      }
    },
  }
}

// The secret-bearing half of a test `Env`: the raw key and the SecretService binding every
// credential read goes through (server/core/secrets.ts). docs/testing.md § Testkit has why these are
// minted together.
export function testSecretEnv(hexKey: string): { SESSION_ENC_KEY: string; SECRETS: SecretService } {
  return { SESSION_ENC_KEY: hexKey, SECRETS: new SecretService(hexKey) }
}

// The 64-hex session key every test in the repo uses (docs/testing.md § Testkit).
export const TEST_ENCRYPTION_KEY = '0'.repeat(64)

// The `c.env` bindings a route test needs, in one place.
//
// The cast is real and stays. `Env` is the full runtime binding set: devices, idempotency, pairing
// codes, blobs and the capability resolver. A test that exercises one route needs only the two or
// three that route touches. Nothing here invents a binding, so pass what the route reads.
export function testEnv(overrides: Partial<Env> = {}): Env {
  return { ...testSecretEnv(TEST_ENCRYPTION_KEY), ...overrides } as unknown as Env
}

// A workspace plugin's Drizzle chain, by id (docs/testing.md § Testkit).
export function workspacePluginMigrations(plugin: string): string | null {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    const candidate = join(dir, 'plugins', plugin, 'migrations')
    if (existsSync(join(candidate, 'meta/_journal.json'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export type TestPluginDb = { db: PluginDatabase; dataDir: string; cleanup: () => void }

// A real per-plugin SQLite file in a temp data root. See docs/testing.md § Testkit for how the
// migration chain resolves. Separate schemas mean a plugin's tests exercise the ownership boundary
// production has.
export function makeTestPluginDb(plugin: string, migrationsFolder: string | null = workspacePluginMigrations(plugin)): TestPluginDb {
  if (!migrationsFolder) {
    throw new Error(`makeTestPluginDb('${plugin}') found no migration chain at plugins/${plugin}/migrations; pass the folder if it lives elsewhere.`)
  }
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
        // Best effort. The OS reaps tmpdir anyway.
      }
    },
  }
}
