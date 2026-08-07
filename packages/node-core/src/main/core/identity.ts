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
