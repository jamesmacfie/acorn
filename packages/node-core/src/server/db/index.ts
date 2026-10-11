import type { BatchItem, BatchResponse } from 'drizzle-orm/batch'
import type { SqliteDrizzle } from '../storage/sqlite'
import * as schema from './schema'
import type { Env } from '../bindings'

// The Drizzle client the routes use. The SQLite driver has no native `.batch()`, so the bootstrap
// (server/bindings.ts) attaches an emulated `batch` (a transaction under the hood). The type-only
// import keeps the type available without pulling the driver into other bundles.
export type AppDatabase = SqliteDrizzle<typeof schema> & {
  batch<U extends BatchItem<'sqlite'>, T extends Readonly<[U, ...U[]]>>(batch: T): Promise<BatchResponse<T>>
  close(): void
}

// One runtime: the client is built once at bootstrap and handed in via env.DB. getDb is an
// identity function, but it stays as the single documented access point. Routes never
// reach for c.env.DB directly, so how the handle is provisioned can change in one place.
export const getDb = (env: Env): AppDatabase => env.DB

export { schema }
