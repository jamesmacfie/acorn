import type { AppDatabase } from '../../server/db'
import type { ActiveIdentityStore } from '../activeIdentity'
import { schema } from '../../server/db'
import { repoMirrorSource } from '../../server/repoMirror'

// Core owns the machine identity. It used to be written by a feature plugin — plugins/github's
// device-flow route set `c.env.ACTIVE_IDENTITY` directly — which made core's answer to "who is the
// user" a side effect of connecting one provider, and would have to be unwound before any real
// multi-user work. Binding is a normal consumer call now, and github is just the caller that happens
// to know a login first.
//
// Any plugin can reach `bind` through ctx.core, exactly as any plugin route could reach
// `c.env.ACTIVE_IDENTITY` before. What stops a second writer is the boundary rule that keeps
// ACTIVE_IDENTITY out of every package but this one (tools/arch/boundaries.test.ts), not the absence
// of a method — a rule can name the one sanctioned caller; a missing method just relocates the hack.
export type IdentityService = {
  // The one identity this node knows, or null when there are none or more than one. Callers that
  // recover ownership of unscoped data must fail closed on null rather than pick.
  sole(): Promise<string | null>
  // The identity bound to this machine, or null before anything has bound one. Read per call: an
  // account switch must not be cached by a long-lived plugin runtime.
  active(): string | null
  // Bind the machine identity to an explicit login. Idempotent for the value already bound.
  bind(userId: string): void
  // Release the binding. With a userId, only when it is the one currently bound — so a disconnect for
  // a stale account cannot unbind the live one.
  unbind(userId?: string): void
}

export function createIdentityService(db: AppDatabase, store: ActiveIdentityStore): IdentityService {
  return {
    active: () => store.get(),
    bind: (userId) => store.set(userId),
    unbind: (userId) => store.clear(userId),
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
