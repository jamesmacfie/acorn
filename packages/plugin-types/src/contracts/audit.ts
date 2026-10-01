// ── Audit ─────────────────────────────────────────────────────────────────────────────────────────

/** What your plugin puts on the node's audit trail, the owner-readable log in Settings → Audit log.
 *
 * Declare each verb in your manifest's `contributions.auditActions`; the host replays those
 * declarations through `declare` and qualifies each as `<yourPluginId>:<actionId>`, so you cannot file
 * a row under a core verb or another plugin's. `record` is refused for anything you did not declare —
 * an action nobody can enumerate is one nobody reviews.
 *
 * Record the events a person reviewing this machine would want to see and could not otherwise: work
 * done unattended, money spent, something leaving the node. Not every call your plugin makes; a trail
 * that logs everything buries the entries worth reading.
 *
 * `details` is an allowlisted bag of scalars you choose per action. Never a request body, a credential,
 * or a file's contents: a trail that quotes what it saw becomes a second copy of the thing it protects.
 * Writing is fire-and-forget, like core's own, so a failed insert can never fail the action it
 * describes. */
export type PluginAuditRegistry = {
  declare(action: { id: string; label: string }): void
  record(action: string, entry?: { subject?: string | null; details?: Record<string, string | number | boolean | null> }): void
}

