import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { AppDatabase } from '../../../server/db'
import type { ActiveIdentityStore } from '../../activeIdentity'

// Core owns the machine identity (docs/authentication.md § Principals). It used to be bound by a
// feature plugin, plugins/github's device-flow route, which made core's answer to "who is the
// user" a side effect of connecting one provider and left every internal caller dead until GitHub
// was connected once.
//
// The identity is minted at boot now: an opaque `owner-<uuid>` written the first time a node starts
// with nothing bound. Installs that bound a GitHub login under the old scheme keep it as their
// opaque owner id forever, so no data rewrite is needed. Providers never bind; a GitHub login is
// metadata on its integration row.
export type IdentityService = {
  // The identity bound to this machine. Read per call rather than cached by a long-lived plugin runtime.
  // null only before ensureBoundIdentity has run.
  active(): string | null
}

export function createIdentityService(store: ActiveIdentityStore): IdentityService {
  return {
    active: () => store.get(),
  }
}

// Tables scoped by user_id whose rows a pre-identity boot could have written under ''. The device
// principal used to fall back to '' before anything was bound, and those rows belong to the owner
// this boot names (docs/authentication.md § Principals).
const USER_SCOPED_TABLES = ['prefs', 'integrations', 'issues', 'issue_resources', 'sync_state'] as const

// Bind the machine identity at boot when nothing is bound yet, then adopt any ''-scoped rows into the
// bound owner. Idempotent and cheap: after the first boot the mint is skipped and the adoption updates
// zero rows. UPDATE OR IGNORE plus DELETE rather than plain UPDATE, because a primary key such as prefs
// (user_id, key) can already hold the owner's row; the owner's copy wins and the '' remnant is dropped.
export function ensureBoundIdentity(db: AppDatabase, store: ActiveIdentityStore): string {
  let owner = store.get()
  if (!owner) {
    owner = `owner-${randomUUID()}`
    store.set(owner)
  }
  for (const table of USER_SCOPED_TABLES) {
    db.run(sql.raw(`UPDATE OR IGNORE ${table} SET user_id = '${owner.replace(/'/g, "''")}' WHERE user_id = ''`))
    db.run(sql.raw(`DELETE FROM ${table} WHERE user_id = ''`))
  }
  return owner
}
