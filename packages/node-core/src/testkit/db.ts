// Test-only helper: a real SQLite DB (node:sqlite, main/sqlite.ts) in a tmp dir with all Drizzle
// migrations applied — no native build to match, whichever runtime hosts the tests.
//
// In testkit/ rather than server/routes/, where it and its two siblings used to live. It was never a
// route; it sat there because that is where it was first needed, and eleven packages then imported a
// test helper through a path that reads like production surface. The directory is the documentation
// now: every `@acorn/node-core/testkit/...` import says out loud that it is test scaffolding, and the
// arch suite fails one from a production file.
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

// The 64-hex session key every test in the repo spells as `'0'.repeat(64)`. Named here so a test can
// seal a credential with the same key the Env it built is using.
export const TEST_ENCRYPTION_KEY = '0'.repeat(64)

// The `c.env` bindings a route test needs, in one place. Route tests have been hand-writing
// `{ DB: db, ...testSecretEnv('0'.repeat(64)) } as unknown as Env` — twenty plugin test files import
// main/bindings.ts for no reason other than to name the type of that cast.
//
// The cast is real and stays deliberate: `Env` is the full runtime binding set (devices, idempotency,
// pairing codes, blobs, the capability resolver), and a test that exercises one route needs the two or
// three of them that route touches. Nothing here invents a binding — pass what the route reads.
export function testEnv(overrides: Partial<Env> = {}): Env {
  return { ...testSecretEnv(TEST_ENCRYPTION_KEY), ...overrides } as unknown as Env
}

// A workspace plugin's Drizzle chain, by id — `<checkout>/plugins/<id>/migrations`.
//
// Test-only, and deliberately dumber than main/pluginMigrations.ts: a suite only ever runs from a source
// checkout, so there is no built or packaged layout to search and no need for the plugin to hand over its
// `import.meta.url`. It replaced twenty `makeTestPluginDb('x', migrationsDir())` call sites whose only
// purpose was to name a path the id already implies, and the eight per-plugin migrations.ts modules
// behind them.
//
// The `plugins/<id>/` segment is spelled out rather than searched for, so this can never resolve to
// core's own chain at packages/node-core/migrations — which a bare ancestor walk from this file would
// find first. A plugin developed outside this checkout passes its folder explicitly instead.
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

// A real per-plugin SQLite file in a temp data root, migrated with that plugin's own chain — resolved
// from the id for a plugin in this checkout, or passed explicitly for one outside it.
//
// Keeping the schemas separate ensures plugin tests exercise the same ownership boundary as production.
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
        // best-effort — tmpdir is reaped by the OS anyway
      }
    },
  }
}
