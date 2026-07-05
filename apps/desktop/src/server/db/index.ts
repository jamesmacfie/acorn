import type { BatchItem, BatchResponse } from 'drizzle-orm/batch'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

// The Drizzle client the routes use. better-sqlite3 has no native `.batch()`, so the bootstrap
// (main/bindings.ts) attaches an emulated `batch` (a transaction under the hood). Type-only import
// keeps the type available without pulling the native module into non-main bundles.
export type AppDatabase = BetterSQLite3Database<typeof schema> & {
  batch<U extends BatchItem<'sqlite'>, T extends Readonly<[U, ...U[]]>>(batch: T): Promise<BatchResponse<T>>
}

// One runtime: the client is built once at bootstrap and handed in via env.DB. getDb is an
// identity function today, but it stays as THE single documented access point — routes never
// reach for c.env.DB directly, so how the handle is provisioned can change in one place.
export const getDb = (env: Env): AppDatabase => env.DB

export { schema }
