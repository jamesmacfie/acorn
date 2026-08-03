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

// Deliberately NOT gated to `kind === 'device'`, and that is a change from V1 worth stating plainly.
//
// V1's internal principal carried `token: ''`, so an agent-spawned child was structurally unable to
// call GitHub. Resolving the credential from a stored row for `ownerId(c)` drops that, because the
// owner is the same for a device and an internal principal — so an agent holding ACORN_API_TOKEN can
// act on GitHub as the owner. That was verified, and gating it here was tried.
//
// It was reverted for two reasons. It buys no real containment: an agent has a shell in the task
// worktree with the owner's git credentials, so it can already push and open pull requests. And it
// breaks a first-party caller — seedTaskNotes runs IN the service and uses the internal token over
// loopback to reuse pullDetail's serve-then-revalidate, so gating it silently stops seeding PR notes
// whenever the mirror is cold.
//
// The real defect underneath is that INTERNAL_TOKEN conflates "the service calling itself" with
// "a child an agent spawned". protocol.md § Transport already describes the fix — internal tokens
// that are task-scoped and route-restricted — and that is a Phase 2 change, not a one-line guard.
// Until then this is a documented divergence, not a guarantee: see docs/vNext/phase1-notes.md.
//
// What an agent still CANNOT do is mint a token, pair, or administer devices — see
// middleware/requireUser.ts's requireDevice, which is where the genuine escalation was.
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
