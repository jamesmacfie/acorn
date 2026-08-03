import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { getDb, schema } from '@acorn/node-core/server/db/index.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { canUseProviderCredential, ownerId } from '@acorn/node-core/server/middleware/requireUser.ts'

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

// Gated on scope, not on principal KIND (server/middleware/requireUser.ts § canUseProviderCredential).
//
// A device may read this; so may the 'service' scope, because the node calls its own HTTP surface over
// loopback to reuse pullDetail's serve-then-revalidate (plugins/notes' seedTaskNotes). A 'task'-scoped
// token — everything injected into a PTY, an agent session, a workflow step or an MCP server — may not.
//
// That restores what V1 enforced structurally (its internal principal carried `token: ''`) and what
// docs/vNext/security.md § Threat model promises. Phase 1 tried gating on kind and reverted it, for two
// reasons that scoping answers: one guard could not tell the service from an agent, so seeding PR notes
// broke whenever the mirror was cold; and an agent with a shell in the worktree can push using the
// owner's git credentials anyway. The second is still true, and is not a reason to hand it a token it
// does not need — the residual risk is documented in docs/vNext/phase2-notes.md rather than papered over.
export async function githubToken(c: Context<AppEnv>): Promise<string> {
  // '' is the "not connected" answer gh()/ghGraphQL() already turn into the synthetic 401 that ghError
  // normalizes to `reauth`, so a denied caller needs no new error plumbing at any of the 34 call sites.
  if (!canUseProviderCredential(c)) return ''
  const db = getDb(c.env)
  const [row] = await db
    .select({ authRef: schema.integrations.authRef })
    .from(schema.integrations)
    .where(and(eq(schema.integrations.userId, ownerId(c)), eq(schema.integrations.provider, GITHUB_PROVIDER)))
  if (row) {
    // useOptional: "not connected" and "credential unreadable" both fall through to '' below, which
    // is the convergence this accessor is built around. The credential is read through
    // CoreServices.secrets, so the github plugin never holds SESSION_ENC_KEY.
    const token = await c.env.SECRETS.useOptional(row.authRef, 'github: api call', (value) => value)
    if (token) return token
  }
  // No fallback. There was a transitional one to the session cookie's token, so the accessor could land
  // before the renderer switched to bearer auth; keeping it past the cookie's deletion would make a
  // MISSING credential ("GitHub was never connected") indistinguishable from a revoked one, which is a
  // materially different thing to tell the user.
  return ''
}
