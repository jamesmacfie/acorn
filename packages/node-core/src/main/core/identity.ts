// The identity read seam (CoreServices.identity). "Which owner identities does this node know about?"
// is a CORE question — core mints `ACTIVE_IDENTITY` (main/bindings.ts), core owns `prefs`, and every
// principal resolves through core's requireUser — so a plugin should never have to answer it by
// scanning tables itself.
//
// It exists because plugins/http's pre-listener migration has to. `protectLegacyHttpStorage` claims
// rows written before the API panel was identity-scoped, and it may claim them ONLY when the database
// contains exactly one identity; with two, an unowned row would otherwise be handed to whichever login
// happened to be first. It used to answer that by reading core's `prefs` AND github's `repos` with
// core's database handle. The first is a plugin reading a core table; the second is a plugin reading
// ANOTHER PLUGIN's table, which the per-plugin database split makes impossible outright
// (docs/vNext/data.md § Plugin DBs).
//
// Deliberately NOT `ACTIVE_IDENTITY`. The active identity is a single value that exists even when the
// database holds two identities, so resolving the migration through it would silently WEAKEN the
// quarantine this function's whole contract is about: "exactly one identity" and "the currently
// selected one" are different questions, and only the first is safe to hand a legacy row to.
//
// The `repos` half is still a core read of a table github will own once it converts. That is the same
// grandfathered debt phase2-notes.md records for agentTools/contextSections.ts and storageFootprint.ts,
// and it is strictly better positioned here: when github becomes a NodePlugin this function is the ONE
// place that has to grow a github-side answer, instead of the http plugin needing an import edge.
import type { AppDatabase } from '../../server/db'
import { schema } from '../../server/db'

export type IdentityService = {
  // The one identity this node knows, or null when there are none or more than one. Callers that
  // recover ownership of unscoped data must fail closed on null rather than pick.
  sole(): Promise<string | null>
}

export function createIdentityService(db: AppDatabase): IdentityService {
  return {
    sole: async () => {
      // Two tables because either can be the only evidence of an identity: a login that connected
      // GitHub has `repos` rows, and one that only ever changed a preference has `prefs` rows.
      const [prefUsers, repoUsers] = await Promise.all([
        db.selectDistinct({ userId: schema.prefs.userId }).from(schema.prefs),
        db.selectDistinct({ userId: schema.repos.userId }).from(schema.repos),
      ])
      const identities = new Set([...prefUsers, ...repoUsers].map((row) => row.userId))
      return identities.size === 1 ? [...identities][0]! : null
    },
  }
}
