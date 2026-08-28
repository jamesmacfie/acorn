import { randomUUID } from 'node:crypto'
import { desc, lt } from 'drizzle-orm'
import type { AppDatabase } from './db'
import { schema } from './db'

// The audit trail's write side (docs/security.md § Audit, docs/data-layer.md § Core DB).
//
// security.md names five classes of action, and this is the closed set that implements them. A closed
// union rather than free-form strings, because the settings surface groups and filters on it, and an
// action nobody can enumerate is one nobody reviews. Same argument as the error-code set in
// docs/api-reference.md § Errors.
export type CoreAuditAction =
  // Pairing and devices. The window open/close pair matters as much as the grant: a pairing window is
  // the one moment this node will hand full owner authority to a stranger who knows a code.
  | 'pairing.window.opened'
  | 'pairing.window.closed'
  | 'device.paired'
  | 'device.revoked'
  // Credentials, write side only. `secret.used` is not recorded (docs/security.md § Audit explains
  // why).
  | 'secret.created'
  | 'secret.replaced'
  | 'secret.deleted'
  // The hash-gated acknowledgement of executable repo config. The one place the owner says "yes, run
  // this", so the record of having said it is worth as much as the gate.
  | 'config.trusted'
  // Node administration: which plugins run decides which routes exist and which databases open.
  | 'plugins.disabled.changed'
  // Attachment to a control plane, both directions (docs/node-enrollment.md). On the same trail as
  // pairing and for the same reason: enrolling hands a stranger a durable credential for this node,
  // and detaching takes it back. `node.enrolled` also records the enrollments that failed, because a
  // provisioned node that never reached its control plane is the failure nobody notices.
  | 'node.enrolled'
  | 'node.detached'
  // Third-party code arriving on, changing on, or leaving this node. The versions and the archive hash
  // ride along in `details` so "what exactly was running in March" is answerable from the trail alone
  // (docs/security.md § Supply chain).
  | 'plugins.installed'
  | 'plugins.updated'
  | 'plugins.uninstalled'
  // A loaded plugin's node half swapped in place, with no bytes arriving and no restart. It changes
  // which code is running, so it belongs on the same trail as the three above.
  | 'plugins.reloaded'
  // An agent asked for a plugin to be installed, updated or removed, and the owner answered. The three
  // rows above say what happened to the node; this one says who asked for it and whether a human agreed
  // (docs/plugins.md § Approval-mediated install).
  | 'plugins.request.decided'
  // Data leaving or entering the node.
  | 'backup.created'

// ── The plugin half of the vocabulary ─────────────────────────────────────────────────────────────
//
// The closed-set argument above survives intact, and this is what keeps it true rather than weakening
// it: a plugin's verbs come from its parsed manifest (or, for a built-in, from a `ctx.audit.declare`
// call), the host qualifies each with the plugin id, and `recordAudit` refuses an action nobody
// declared. So the vocabulary is still enumerable — `auditVocabulary()` below is the enumeration — and
// the settings surface can name every verb it might draw. It is the same trade the harness registry
// already makes.
//
// Why it had to open at all: nothing a plugin does was on the trail, and for an agent-driven product
// the interesting events (a run cost money, a workflow pushed a branch, a schedule made an outbound
// request with the owner's credentials) are exactly the ones the one surface built for review could
// not see (2026-08-27 extensibility review, finding 9).
//
// `<pluginId>:<actionId>`. No core action contains a colon, so a plugin can never take a core verb's
// place, and the id is minted here rather than read off a descriptor — the same rule a plugin theme's
// id, a qualified harness id and an extension point's id follow.
export type PluginAuditAction = `${string}:${string}`

export const qualifiedAuditAction = (pluginId: string, actionId: string): PluginAuditAction =>
  `${pluginId}:${actionId}`

export type AuditAction = CoreAuditAction | PluginAuditAction

/** One declared plugin verb, as the registry holds it. */
export type DeclaredAuditAction = { action: PluginAuditAction; pluginId: string; label: string }

// A module singleton, like the route, collection, node-action and task-check registries beside it, with
// the same lifecycle answer: the plugin host clears a plugin's entries before re-registering them
// (server/plugin/host.ts § clearRegistrations).
const declared = new Map<string, DeclaredAuditAction>()

/** Declare one verb for a plugin. The host binds `pluginId`; a plugin never passes it. */
export function declareAuditAction(pluginId: string, action: { id: string; label: string }): void {
  const qualified = qualifiedAuditAction(pluginId, action.id)
  const clash = declared.get(qualified)
  if (clash && clash.label !== action.label) {
    throw new Error(`Duplicate audit action '${qualified}': already declared as '${clash.label}'.`)
  }
  declared.set(qualified, { action: qualified, pluginId, label: action.label })
}

export function clearAuditActions(pluginId: string): void {
  for (const [id, entry] of declared) if (entry.pluginId === pluginId) declared.delete(id)
}

/** Every verb this node can write, core's and every running plugin's. What the settings surface reads
 *  so it can label a row it has never seen, and the reason opening the set to plugins did not make the
 *  trail unreviewable. */
export const auditVocabulary = (): DeclaredAuditAction[] =>
  [...declared.values()].sort((a, b) => a.action.localeCompare(b.action))

/** Is this action one the node is willing to write? A core verb is trusted by construction — it is a
 *  literal in this binary — and a qualified one has to have been declared. Fail closed: an undeclared
 *  action writes nothing, because a trail that accepts arbitrary verbs is one nobody can enumerate,
 *  and enumerability is the whole point of the closed set. */
export const isKnownAuditAction = (action: string): boolean =>
  action.includes(':') ? declared.has(action) : true

export type AuditActor = { actor: 'device' | 'internal' | 'system'; actorId?: string | null }

export type AuditEntry = AuditActor & {
  action: AuditAction
  subject?: string | null
  // Allowlisted scalars, decided at the call site. Never a request body, a credential, or a file's
  // contents: an audit trail that quotes what it saw becomes a second copy of the thing it protects.
  details?: Record<string, string | number | boolean | null>
}

export const AUDIT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000

// Fire-and-forget, and the `void` at each call site matters: a failed audit write must not fail the
// action it describes. Refusing to revoke a stolen device because a logging insert threw would be
// strictly worse for the owner than a missing row. The row is evidence, and the revoke is the thing
// that protects them. Same reasoning as `lastSeenAt` in auth/deviceTokens.ts, which is best-effort
// for the same reason.
export function recordAudit(db: AppDatabase, entry: AuditEntry): void {
  // Checked here rather than at the plugin seam, so it holds for every feeder including a built-in that
  // reached for a verb it never declared. A warning and no row: this is fire-and-forget, and throwing
  // would fail the action being described.
  if (!isKnownAuditAction(entry.action)) {
    console.warn('[audit] refusing an undeclared action', entry.action)
    return
  }
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

// 90-day retention (docs/schedules.md § What is registered today, `core:audit-prune`). Returns the
// number of rows it removed, which is the one line the run row carries.
export async function pruneAudit(db: AppDatabase, now: number = Date.now()): Promise<number> {
  const result = await db.delete(schema.audit).where(lt(schema.audit.at, now - AUDIT_RETENTION_MS))
  return Number(result.changes ?? 0)
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
// offset, because rows are only ever appended and pruned from the far end. An offset would skip or
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
