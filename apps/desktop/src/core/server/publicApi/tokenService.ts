import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { and, eq, lte } from 'drizzle-orm'
import type { AppDatabase } from '../db'
import { schema } from '../db'
import type { ApiScopes } from '../../shared/publicApi/primitives'

// Bearer token issue / parse / verify / revoke (docs/public-api.md). The
// raw token is shown once; only SHA-256(secret) is stored. A 256-bit random secret makes offline
// hash guessing infeasible, so no password/reversible encryption is layered on.

// acorn_v1_<uuid>_<base64url(32 bytes)>. Anchored so trailing garbage/whitespace is rejected.
const TOKEN_RE = /^acorn_v1_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([A-Za-z0-9_-]{43})$/

const LAST_USED_THROTTLE_MS = 5 * 60_000

function sha256(input: string): Buffer {
  return createHash('sha256').update(input).digest()
}

function scopesFor(canWrite: boolean): ApiScopes {
  return canWrite ? ['read', 'write'] : ['read']
}

export type ApiTokenSummary = {
  id: string
  name: string
  prefix: string
  scopes: ApiScopes
  createdAt: number
  lastUsedAt: number | null
  expiresAt: number | null
  revokedAt: number | null
}

export type CreatedApiToken = { token: string; metadata: ApiTokenSummary }

// The resolved public principal. user fields come from the linked oauth_accounts row (§7).
export type ApiTokenPrincipal = {
  kind: 'api-token'
  tokenId: string
  userId: string
  name: string
  prefix: string
  scopes: ApiScopes
  expiresAt: number | null
  user: { login: string; name: string; avatar: string }
}

type Clock = () => number

export class TokenService {
  private readonly revokeListeners = new Set<(tokenId: string) => void>()

  constructor(
    private readonly db: AppDatabase,
    private readonly now: Clock = () => Date.now(),
  ) {}

  // Subscribe to in-process revocations (the public WS hub closes that token's sockets). Returns an
  // unsubscribe fn.
  onRevoked(listener: (tokenId: string) => void): () => void {
    this.revokeListeners.add(listener)
    return () => this.revokeListeners.delete(listener)
  }

  async create(input: { userId: string; name: string; scopes: ApiScopes; expiresAt: number | null }): Promise<CreatedApiToken> {
    const now = this.now()
    if (input.expiresAt !== null && input.expiresAt <= now) {
      throw new Error('expiresAt must be in the future')
    }
    const id = randomUUID()
    const secret = randomBytes(32).toString('base64url') // 43 chars, unpadded
    const token = `acorn_v1_${id}_${secret}`
    const canWrite = (input.scopes as readonly string[]).includes('write')
    const prefix = `acorn_v1_${id.slice(0, 8)}` // identifiable, never secret-derived

    await this.db.insert(schema.apiTokens).values({
      id,
      userId: input.userId,
      name: input.name,
      tokenPrefix: prefix,
      secretHash: sha256(secret),
      canWrite,
      createdAt: now,
      lastUsedAt: null,
      expiresAt: input.expiresAt,
      revokedAt: null,
    })

    return {
      token,
      metadata: {
        id,
        name: input.name,
        prefix,
        scopes: scopesFor(canWrite),
        createdAt: now,
        lastUsedAt: null,
        expiresAt: input.expiresAt,
        revokedAt: null,
      },
    }
  }

  // Authenticate a raw bearer value. Returns the resolved principal or null. Missing, malformed,
  // unknown, expired, revoked, and wrong-secret all return null (the endpoint must not become a
  // token-status oracle — §6). Never throws on bad input.
  async authenticate(bearer: string | undefined): Promise<ApiTokenPrincipal | null> {
    if (!bearer) return null
    const match = TOKEN_RE.exec(bearer)
    if (!match) return null
    const [, id, secret] = match

    const [row] = await this.db.select().from(schema.apiTokens).where(eq(schema.apiTokens.id, id)).limit(1)
    if (!row) return null
    const now = this.now()
    if (row.revokedAt !== null) return null
    if (row.expiresAt !== null && row.expiresAt <= now) return null

    const presented = sha256(secret)
    const stored = row.secretHash as unknown as Buffer
    if (stored.length !== presented.length || !timingSafeEqual(stored, presented)) return null

    // last-used throttle: at most one write per token per 5 minutes, off the request path.
    if (row.lastUsedAt === null || now - row.lastUsedAt >= LAST_USED_THROTTLE_MS) {
      void (async () => {
        try {
          await this.db.update(schema.apiTokens).set({ lastUsedAt: now }).where(eq(schema.apiTokens.id, id))
        } catch {
          // last-used is best-effort telemetry; a write failure must not fail authentication
        }
      })()
    }

    const account = await this.loadAccount(row.userId)
    return {
      kind: 'api-token',
      tokenId: id,
      userId: row.userId,
      name: row.name,
      prefix: row.tokenPrefix,
      scopes: scopesFor(row.canWrite),
      expiresAt: row.expiresAt,
      user: account ?? { login: row.userId, name: '', avatar: '' },
    }
  }

  private async loadAccount(userId: string): Promise<{ login: string; name: string; avatar: string } | null> {
    const [acct] = await this.db
      .select({ login: schema.oauthAccounts.login, name: schema.oauthAccounts.name, avatar: schema.oauthAccounts.avatar })
      .from(schema.oauthAccounts)
      .where(eq(schema.oauthAccounts.userId, userId))
      .limit(1)
    return acct ?? null
  }

  async list(userId: string): Promise<ApiTokenSummary[]> {
    const rows = await this.db.select().from(schema.apiTokens).where(eq(schema.apiTokens.userId, userId))
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((row) => ({
        id: row.id,
        name: row.name,
        prefix: row.tokenPrefix,
        scopes: scopesFor(row.canWrite),
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
      }))
  }

  // Idempotent revocation. Returns false (→ caller 404s) if the token never belonged to this user;
  // returns true whether or not it was already revoked. Notifies listeners so live sockets close.
  async revoke(userId: string, id: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: schema.apiTokens.id, revokedAt: schema.apiTokens.revokedAt })
      .from(schema.apiTokens)
      .where(and(eq(schema.apiTokens.id, id), eq(schema.apiTokens.userId, userId)))
      .limit(1)
    if (!row) return false
    if (row.revokedAt === null) {
      await this.db.update(schema.apiTokens).set({ revokedAt: this.now() }).where(eq(schema.apiTokens.id, id))
    }
    for (const listener of this.revokeListeners) listener(id)
    return true
  }

  // Maintenance sweep: drop rows for tokens expired long ago and idempotency records past their
  // window. Cleanup is housekeeping, not an authentication correctness path.
  async cleanupExpired(): Promise<void> {
    const now = this.now()
    await this.db.delete(schema.apiIdempotency).where(lte(schema.apiIdempotency.expiresAt, now))
  }
}
