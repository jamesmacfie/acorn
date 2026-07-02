// Test-only helper: a real better-sqlite3 DB in a tmp dir with all Drizzle migrations applied —
// the plan's pattern for DB-shape-critical route tests. Requires the Node ABI build of
// better-sqlite3 (`pnpm --filter @acorn/web node:rebuild`); vitest runs under plain Node.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../../main/bindings'
import type { AppDatabase } from '../db'

export type TestDb = { db: AppDatabase; cleanup: () => void }

export function makeTestDb(): TestDb {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-test-'))
  const db = openDb(join(dir, 'test.sqlite'))
  return {
    db,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // best-effort — tmpdir is reaped by the OS anyway
      }
    },
  }
}
