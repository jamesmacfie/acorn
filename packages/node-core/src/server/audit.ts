import { randomUUID } from 'node:crypto'
import { desc, lt } from 'drizzle-orm'
import type { AppDatabase } from './db'
import { schema } from './db'

// The audit trail's write side (docs/security.md § Audit, docs/data-layer.md § Core DB).
//
// security.md names five classes of action, and this is the closed set that implements them. A closed
// union rather than free-form strings because the settings surface groups and filters on it, and an
// action nobody can enumerate is one nobody reviews — the same argument as the error-code set in
// docs/api-reference.md § Errors.
export type AuditAction =
  // Pairing and devices. The window open/close pair matters as much as the grant: a pairing window is
  // the one moment this node will hand full owner authority to a stranger who knows a code.
  | 'pairing.window.opened'
  | 'pairing.window.closed'
  | 'device.paired'
  | 'device.revoked'
  // Credentials, write side only. security.md § Audit also lists secret *use*, and it is deliberately
  // absent — see the note at the bottom of this file.
  | 'secret.created'
  | 'secret.replaced'
  | 'secret.deleted'
  // The hash-gated acknowledgement of executable repo config. The one place the owner says "yes, run
  // this", so the record of having said it is worth as much as the gate.
  | 'config.trusted'
  // Node administration: which plugins run decides which routes exist and which databases open.
  | 'plugins.disabled.changed'
  // Data leaving or entering the node.
  | 'backup.created'
  | 'import.v1'

export type AuditActor = { actor: 'device' | 'internal' | 'system'; actorId?: string | null }

export type AuditEntry = AuditActor & {
  action: AuditAction
  subject?: string | null
  // Allowlisted scalars, decided at the call site. Never a request body, a credential, or a file's
  // contents: an audit trail that quotes what it saw becomes a second copy of the thing it protects.
  details?: Record<string, string | number | boolean | null>
}

export const AUDIT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000

// Fire-and-forget by design, and the `void` at each call site is the point rather than an oversight.
//
// A failed audit write must not fail the action it describes. Refusing to revoke a stolen device
// because a logging insert threw would be strictly worse for the owner than a missing row — the row is
// evidence, and the revoke is the thing that protects them. Same reasoning as `lastSeenAt` in
// auth/deviceTokens.ts, which is best-effort for the same reason.
export function recordAudit(db: AppDatabase, entry: AuditEntry): void {
  void (async () => {
    try {
      await db.insert(schema.audit).values({
        id: randomUUID(),
        at: Date.now(),
        actor: entry.actor,
        actorId: entry.actorId ?? null,
        action: entry.action,
        subject: entry.subject ?? null,
        details: entry.details ? JSON.stringify(entry.details) : null,
      })
    } catch (error) {
      console.warn('[audit] failed to record', entry.action, error)
    }
  })()
}

// ## Why `secret.used` is not here, though security.md § Audit lists it
//
// Every credential read goes through `SecretService.use` (main/core/secrets.ts), whose whole design is
// that the encryption key has exactly one holder: it is constructed from a hex key and nothing else —
// no database, no request, no connection id. Its `ref` argument is the CIPHERTEXT, so a row written
// from there could only name the credential by a hash of it.
//
// Recording every read would also turn this table into a request log — a mirror refresh reads the
// GitHub token on a timer — and bury the handful of decisions an owner actually reviews. Recording a
// deduplicated first-use-per-process would avoid the flood but answer a much weaker question ("something
// read a credential at some point this run") for a real cost: threading a database and a connection id
// into the one class deliberately built to hold neither.
//
// The nearest cheap alternative was auditing `githubToken(c)`, the single read site for that one
// provider. Rejected because partial coverage recorded as if it were complete is worse than none: an
// owner reading a trail that names only GitHub would reasonably conclude nothing else spends a
// credential. Recorded as a deliberate divergence rather than silently skipped.

// 90-day retention (docs/data-layer.md § Retention defaults), run at boot beside the idempotency cleanup rather
// than on a timer: a node that is never restarted is also one that is never accumulating a backlog
// worth pruning, and a scheduler for one range-delete a day is machinery this does not need.
export async function pruneAudit(db: AppDatabase, now: number = Date.now()): Promise<void> {
  await db.delete(schema.audit).where(lt(schema.audit.at, now - AUDIT_RETENTION_MS))
}

export type AuditRow = {
  id: string
  at: number
  actor: string
  actorId: string | null
  action: string
  subject: string | null
  details: Record<string, unknown> | null
}

// The read side: most recent first, one page at a time. `before` is a timestamp cursor rather than an
// offset because rows are only ever appended and pruned from the far end — an offset would skip or
// repeat rows as the prune runs underneath a paging reader.
export async function readAudit(db: AppDatabase, options: { before?: number; limit?: number } = {}): Promise<AuditRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500)
  const rows = await (options.before === undefined
    ? db.select().from(schema.audit).orderBy(desc(schema.audit.at)).limit(limit)
    : db.select().from(schema.audit).where(lt(schema.audit.at, options.before)).orderBy(desc(schema.audit.at)).limit(limit))
  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    actor: row.actor,
    actorId: row.actorId,
    action: row.action,
    subject: row.subject,
    // A row whose details will not parse is still a row worth showing: the action, the actor and the
    // time are the load-bearing fields, and dropping the whole entry over a bad JSON blob would lose
    // exactly the evidence someone is looking for.
    details: parseDetails(row.details),
  }))
}

function parseDetails(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}
