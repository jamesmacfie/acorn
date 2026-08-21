// Test-only helper: a real SQLite DB (node:sqlite, main/sqlite.ts) in a tmp dir with all Drizzle
// migrations applied, no native build to match whichever runtime hosts the tests. See
// docs/testing.md § Testkit for why this lives in its own directory.
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb, type Env } from '../main/bindings'
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
        // best effort. tmpdir is reaped by the OS anyway.
      }
    },
  }
}

// The secret-bearing half of a test `Env`: the raw key and the SecretService binding every
// credential read goes through (main/core/secrets.ts). docs/testing.md § Testkit has why these are
// minted together.
export function testSecretEnv(hexKey: string): { SESSION_ENC_KEY: string; SECRETS: SecretService } {
  return { SESSION_ENC_KEY: hexKey, SECRETS: new SecretService(hexKey) }
}

// The 64-hex session key every test in the repo uses (docs/testing.md § Testkit).
export const TEST_ENCRYPTION_KEY = '0'.repeat(64)

// The `c.env` bindings a route test needs, in one place. Route tests used to hand-write
// `{ DB: db, ...testSecretEnv('0'.repeat(64)) } as unknown as Env`, and twenty plugin test files
// imported main/bindings.ts only to name the type of that cast.
//
// The cast is real and stays: `Env` is the full runtime binding set (devices, idempotency, pairing
// codes, blobs, the capability resolver), and a test that exercises one route needs only the two or
// three of them that route touches. Nothing here invents a binding; pass what the route reads.
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

// A real per-plugin SQLite file in a temp data root (docs/testing.md § Testkit has how the migration
// chain resolves). Keeping the schemas separate means a plugin's tests exercise the same ownership
// boundary production does.
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
        // best effort. tmpdir is reaped by the OS anyway.
      }
    },
  }
}
