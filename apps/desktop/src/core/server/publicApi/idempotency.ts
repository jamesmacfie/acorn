import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { AppDatabase } from '../db'
import { schema } from '../db'

// Idempotency replay (docs/next/api/protocol.md §7). Stores (tokenId, operationId, key) → request
// hash + response for 24h. Same request replays the stored response; a different request under the
// same key is a conflict. 5xx responses are never cached.

const TTL_MS = 24 * 60 * 60_000

export function requestHash(method: string, path: string, rawBody: string): string {
  return createHash('sha256').update(`${method}\n${path}\n${rawBody}`).digest('hex')
}

export type StoredResponse = { requestHash: string; responseStatus: number; responseBody: string }

export class IdempotencyStore {
  constructor(
    private readonly db: AppDatabase,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async lookup(tokenId: string, operationId: string, key: string): Promise<StoredResponse | null> {
    const [row] = await this.db
      .select()
      .from(schema.apiIdempotency)
      .where(
        and(
          eq(schema.apiIdempotency.tokenId, tokenId),
          eq(schema.apiIdempotency.operationId, operationId),
          eq(schema.apiIdempotency.key, key),
        ),
      )
      .limit(1)
    if (!row) return null
    if (row.expiresAt <= this.now()) return null // expired rows are treated as absent
    return { requestHash: row.requestHash, responseStatus: row.responseStatus, responseBody: row.responseBody }
  }

  async save(
    tokenId: string,
    operationId: string,
    key: string,
    hash: string,
    responseStatus: number,
    responseBody: string,
  ): Promise<void> {
    const now = this.now()
    await this.db
      .insert(schema.apiIdempotency)
      .values({ tokenId, operationId, key, requestHash: hash, responseStatus, responseBody, createdAt: now, expiresAt: now + TTL_MS })
      .onConflictDoNothing()
  }
}
