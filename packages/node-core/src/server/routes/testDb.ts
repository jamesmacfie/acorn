// Test-only helper: a real better-sqlite3 DB in a tmp dir with all Drizzle migrations applied —
// the plan's pattern for DB-shape-critical route tests. Requires the Node ABI build of
// better-sqlite3 (`pnpm --filter @acorn/desktop node:rebuild`); vitest runs under plain Node.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../../main/bindings'
import { SecretService } from '../../main/core/secrets'
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
