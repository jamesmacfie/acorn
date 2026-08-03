import { createHash } from 'node:crypto'
import { and, eq, lte } from 'drizzle-orm'
import type { AppDatabase } from '../db'
import { schema } from '../db'

// Idempotency replay storage (docs/vNext/protocol.md § HTTP conventions). Keyed (deviceId, key):
// the same request replays the stored response, a different request under the same key is a
// conflict, and 5xx is never stored so a genuine retry re-executes.
//
// Recovered from V1's /api/v1 store, re-keyed from (tokenId, operationId, key) — vNext has no
// per-endpoint operationId, and the path is already part of the request hash.

const TTL_MS = 24 * 60 * 60_000

export const requestHash = (method: string, path: string, rawBody: string): string =>
  createHash('sha256').update(`${method}\n${path}\n${rawBody}`).digest('hex')

export type StoredResponse = { requestHash: string; responseStatus: number; responseBody: string }

export type IdempotencyStore = {
  lookup(deviceId: string, key: string): Promise<StoredResponse | null>
  save(deviceId: string, key: string, hash: string, responseStatus: number, responseBody: string): Promise<void>
  cleanupExpired(): Promise<void>
}

export function idempotencyStore(db: AppDatabase, now: () => number = () => Date.now()): IdempotencyStore {
  return {
    async lookup(deviceId, key) {
      const [row] = await db
        .select()
        .from(schema.idempotency)
        .where(and(eq(schema.idempotency.deviceId, deviceId), eq(schema.idempotency.key, key)))
        .limit(1)
      if (!row) return null
      // Expired rows read as absent rather than being deleted here: a read path that writes would
      // turn every GET-after-expiry into a transaction. cleanupExpired() sweeps them at boot.
      if (row.expiresAt <= now()) return null
      return { requestHash: row.requestHash, responseStatus: row.responseStatus, responseBody: row.responseBody }
    },

    async save(deviceId, key, hash, responseStatus, responseBody) {
      const at = now()
      await db
        .insert(schema.idempotency)
        .values({ deviceId, key, requestHash: hash, responseStatus, responseBody, createdAt: at, expiresAt: at + TTL_MS })
        // A concurrent duplicate may have stored first. Its response is the one already returned to
        // the other caller, so keeping it is what makes the replay consistent.
        .onConflictDoNothing()
    },

    async cleanupExpired() {
      await db.delete(schema.idempotency).where(lte(schema.idempotency.expiresAt, now()))
    },
  }
}
