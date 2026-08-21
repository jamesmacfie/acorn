import type { Context } from 'hono'
import { recordAudit, type AuditEntry } from './audit'
import type { AppDatabase } from './db'
import { getDb } from './db'
import type { AppEnv } from './middleware/auth'

// The request-side half of the audit trail. Kept apart from server/audit.ts so that module stays free
// of Hono: it is also called from auth/deviceTokens.ts, which has a database and no request.

// Who to record against a row.
//
// A device principal records its device id, which is what makes "which of my machines revoked this one?"
// answerable from the trail. An internal principal records its scope rather than its task or
// session: the scope is what decided whether the call was allowed at all, and it is the field an owner
// reviewing the trail can act on.
export const auditActor = (c: Context<AppEnv>): { actor: 'device' | 'internal' | 'system'; actorId?: string | null } => {
  const principal = c.get('principal')
  if (!principal) return { actor: 'system' }
  return principal.kind === 'device'
    ? { actor: 'device', actorId: principal.deviceId ?? null }
    : { actor: 'internal', actorId: principal.scope ?? null }
}

// Record an action against the caller. One call rather than the three-part
// `recordAudit(getDb(c.env), { ...auditActor(c), … })` every route would otherwise repeat, and the
// difference is not brevity: `getDb` throws when there is no database binding, so the spelled-out form
// put an audit write in front of the action it was describing and could fail it. That is precisely the
// promise recordAudit's fire-and-forget shape exists to make, undone one layer up. It showed up
// immediately as a 500 from a focused route test whose app has no bindings.
export function auditRequest(c: Context<AppEnv>, entry: Omit<AuditEntry, 'actor' | 'actorId'>): void {
  let db: AppDatabase
  try {
    db = getDb(c.env)
  } catch {
    return // no database on this app — nothing to write to, and nothing worth failing the request over
  }
  recordAudit(db, { ...auditActor(c), ...entry })
}
