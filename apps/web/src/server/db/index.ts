import { drizzle as drizzleD1 } from 'drizzle-orm/d1'
import type { BatchItem, BatchResponse } from 'drizzle-orm/batch'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

// The Drizzle client the routes use. better-sqlite3 lacks D1's `.batch()`, so the Node
// bootstrap (main/bindings.ts) attaches an emulated `batch` (transaction under the hood).
// Type-only better-sqlite3 import keeps the native module out of the worker bundle; both
// drivers' clients are structurally compatible for what the routes call.
export type AppDatabase = BetterSQLite3Database<typeof schema> & {
  batch<U extends BatchItem<'sqlite'>, T extends Readonly<[U, ...U[]]>>(batch: T): Promise<BatchResponse<T>>
}

// Runtime-agnostic: the Node bootstrap injects a ready-built better-sqlite3 client (already has
// query methods), while Workers inject a raw D1 namespace that must be wrapped per request. Both
// paths must keep working in parallel through Phase 1 — see docs/electron.md §4c.
export const getDb = (env: Env): AppDatabase => {
  const db = env.DB as unknown
  if (db && typeof (db as { select?: unknown }).select === 'function') return db as AppDatabase
  return drizzleD1(env.DB, { schema }) as unknown as AppDatabase
}

export { schema }
