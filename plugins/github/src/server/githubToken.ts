import type { Context } from 'hono'
import { providerCredential } from '@acorn/node-core/server/integrations/credential.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'

// The one place a GitHub credential is read (docs/vNext/plan.md § Phase 1: "GitHub OAuth becomes an
// integration credential written to the node").
//
// It used to come off the principal — `ownerId(c).token`, decrypted from the session cookie, at 34
// call sites. That cannot survive the auth swap: a device-token principal has no GitHub token,
// because a device is an identity, not a provider credential. So the credential moves to a stored
// `integrations` row, encrypted at rest, and every caller reads it through here.
//
// `integrations` is CORE's table and stays core's — it is the connection registry the whole provider
// runtime is keyed on — so once this plugin owns its own SQLite file the read cannot be a query any
// more. It is a core seam: `providerCredential` (server/integrations/credential.ts).
//
// THAT SEAM ALSO OWNS THE GATE, which is the part worth knowing before touching this file. The scope
// check that stops a 'task'-scoped internal token spending the owner's credential —
// canUseProviderCredential — used to be the first line of this function, and every other provider had
// to remember to write its own. The adversarial review recorded in docs/vNext/phase2-notes.md found
// exactly that failure mode: the check guarded one plugin of five. It is inside the core helper now, so
// there is no ungated way to reach a stored credential and nothing to re-check here. Do not add a
// second check — a duplicate would drift.
//
// Returns '' rather than throwing when GitHub is not connected, when the credential is unreadable, and
// when the caller is denied. gh()/ghGraphQL() turn an empty token into the same synthetic 401 a
// rejected token produces, which ghError already normalizes to `reauth` and the client already
// handles — so this needs no new error plumbing at any of the 34 sites, all three outcomes land in one
// place for the user, and a denied caller cannot use the distinction as an oracle for which providers
// the owner has connected.
//
// Not memoized: a route resolves this two or three times at most, and each resolution is one indexed
// SELECT plus a JWE decrypt. Caching it on c.env would be a few microseconds saved in exchange for a
// cross-request leak in every test that reuses one env object.

export const GITHUB_PROVIDER = 'github'

export async function githubToken(c: Context<AppEnv>): Promise<string> {
  return providerCredential(c, GITHUB_PROVIDER)
}
