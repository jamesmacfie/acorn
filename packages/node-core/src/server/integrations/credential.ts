// Read a provider's stored credential for the calling principal.
//
// This exists because `integrations` is CORE's table and always was: it is the connection registry the
// whole provider runtime is keyed on. Once plugins/github owns its own SQLite file it has no handle to
// core's, so `githubToken.ts` — the documented single read site for the GitHub credential — needs a seam
// rather than `getDb(c.env)`.
//
// THE GATE LIVES HERE, not at the call site, and that is the point of putting it in core. Before, every
// provider that read a credential had to remember `canUseProviderCredential(c)` itself, and the
// adversarial review recorded in docs/vNext/phase2-notes.md found exactly that failure: the gate
// guarded one plugin of five. A provider that starts reading a credential now inherits the check by
// construction — there is no ungated way to get here.
//
// Returns '' rather than throwing, for two different reasons that deliberately converge:
//   - not connected: there is no row.
//   - denied: a 'task'-scoped internal token (a PTY, an agent session, a workflow step, an MCP server)
//     may not spend the owner's provider credentials.
// Both produce the same empty string, which every provider client already turns into the synthetic 401
// its error taxonomy normalizes to "reconnect". A denied caller therefore needs no new error plumbing,
// and — importantly — cannot distinguish "denied" from "not connected" and use this as an oracle for
// which providers the owner has connected.
import { and, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'
import { canUseProviderCredential, ownerId } from '../middleware/requireUser'

export async function providerCredential(c: Context<AppEnv>, providerId: string): Promise<string> {
  if (!canUseProviderCredential(c)) return ''
  const [row] = await getDb(c.env)
    .select({ authRef: schema.integrations.authRef })
    .from(schema.integrations)
    .where(and(eq(schema.integrations.userId, ownerId(c)), eq(schema.integrations.provider, providerId)))
  if (!row) return ''
  // useOptional: "unreadable credential" falls through to '' as well, which keeps the three outcomes
  // converged. The read goes through CoreServices.secrets, so no plugin ever holds SESSION_ENC_KEY.
  return (await c.env.SECRETS.useOptional(row.authRef, `${providerId}: api call`, (value) => value)) ?? ''
}
