import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { getDb, schema } from '@acorn/node-core/server/db/index.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { ownerId } from '@acorn/node-core/server/middleware/requireUser.ts'
import { decryptSecret } from '@acorn/node-core/server/secretBox.ts'

// The one place a GitHub credential is read (docs/vNext/plan.md § Phase 1: "GitHub OAuth becomes an
// integration credential written to the node").
//
// It used to come off the principal — `ownerId(c).token`, decrypted from the session cookie, at 34
// call sites. That cannot survive the auth swap: a device-token principal has no GitHub token,
// because a device is an identity, not a provider credential. So the credential moves to a stored
// `integrations` row, encrypted at rest, and every caller reads it through here.
//
// Returns '' rather than throwing when GitHub is not connected. gh()/ghGraphQL() turn an empty token
// into the same synthetic 401 a rejected token produces, which ghError already normalizes to
// `reauth` and the client already handles — so this needs no new error plumbing at any of the 34
// sites, and "never connected" and "credential revoked" land in one place for the user.
//
// Not memoized: a route resolves this two or three times at most, and each resolution is one indexed
// SELECT plus a JWE decrypt. Caching it on c.env would be a few microseconds saved in exchange for a
// cross-request leak in every test that reuses one env object.

export const GITHUB_PROVIDER = 'github'

export async function githubToken(c: Context<AppEnv>): Promise<string> {
  const db = getDb(c.env)
  const [row] = await db
    .select({ authRef: schema.integrations.authRef })
    .from(schema.integrations)
    .where(and(eq(schema.integrations.userId, ownerId(c)), eq(schema.integrations.provider, GITHUB_PROVIDER)))
  if (row) {
    const token = await decryptSecret(row.authRef, c.env.SESSION_ENC_KEY)
    if (token) return token
  }
  // No fallback. There was a transitional one to the session cookie's token, so the accessor could land
  // before the renderer switched to bearer auth; keeping it past the cookie's deletion would make a
  // MISSING credential ("GitHub was never connected") indistinguishable from a revoked one, which is a
  // materially different thing to tell the user.
  return ''
}
