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
// The `repos` half is no longer a core table read: github owns that table now, and this function grew the
// github-side answer its previous comment said it would — through `repoMirrorSource()`, the one slot the
// composition root fills with that plugin's capability (server/repoMirror.ts). The http plugin still needs
// no import edge, which was the point.
import type { AppDatabase } from '../../server/db'
import { schema } from '../../server/db'
import { repoMirrorSource } from '../../server/repoMirror'

export type IdentityService = {
  // The one identity this node knows, or null when there are none or more than one. Callers that
  // recover ownership of unscoped data must fail closed on null rather than pick.
  sole(): Promise<string | null>
}

export function createIdentityService(db: AppDatabase): IdentityService {
  return {
    sole: async () => {
      // Two sources because either can be the only evidence of an identity: a login that connected
      // GitHub has mirror rows, and one that only ever changed a preference has `prefs` rows. They now sit
      // in two different SQLite files, which is why the second arrives through the mirror slot rather than
      // as a second query on this handle.
      //
      // An UNFILLED slot makes this see fewer identities, so it is more likely to return null — and null is
      // the fail-closed answer that refuses to hand an unowned legacy row to a guessed owner. The
      // degradation therefore cannot cause a wrong claim, only a skipped one.
      const [prefUsers, mirrorUsers] = await Promise.all([
        db.selectDistinct({ userId: schema.prefs.userId }).from(schema.prefs),
        repoMirrorSource().identities(),
      ])
      const identities = new Set([...prefUsers.map((row) => row.userId), ...mirrorUsers])
      return identities.size === 1 ? [...identities][0]! : null
    },
  }
}
