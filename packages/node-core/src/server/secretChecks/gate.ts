// The optional publication gate and its one-operation allowances (docs/security/secret-publication.md
// § Policy). One owner for this mutable state: the decisions below, held in this node process.
//
// In memory on purpose. An allowance lives ten minutes, so a restart that forgets one only asks the
// owner again, and nothing here ever holds a matched value. A decision binds the operation, its
// destination, the content digest, and the detector version; a change to any of them is a new
// decision. Only the device route in ../routes/security/secretPublication.ts can allow one.
import { createHash } from 'node:crypto'
import {
  SECRET_PUBLICATION_PREF_KEY,
  type SecretCheckReport,
  type SecretPublicationDecision,
  type SecretPublicationOperation,
  type SecretPublicationRefusal,
} from '@acorn/protocol/secretChecks.ts'
import { recordAudit, type AuditActor } from '../audit'
import type { AppDatabase } from '../db'
import type { IdentityService } from '../core/identity'
import type { PrefService } from '../core/prefs'

export const SECRET_DECISION_TTL_MS = 10 * 60_000
const MAX_DECISIONS = 50

const decisions = new Map<string, SecretPublicationDecision>()

function prune(now: number): void {
  for (const [id, decision] of decisions) if (decision.expiresAt <= now) decisions.delete(id)
  // Oldest first: a Map iterates in insertion order.
  while (decisions.size > MAX_DECISIONS) decisions.delete(decisions.keys().next().value!)
}

const decisionId = (operation: SecretPublicationOperation, destination: string, report: SecretCheckReport): string =>
  createHash('sha256')
    .update(JSON.stringify([operation, destination, report.digest, report.detectorVersion]))
    .digest('hex')

function audit(
  db: AppDatabase,
  actor: AuditActor,
  decision: SecretPublicationDecision,
  action: 'secrets.publication.blocked' | 'secrets.publication.allowed',
  detail: string,
): void {
  recordAudit(db, {
    ...actor,
    action,
    subject: decision.operation,
    details: {
      decision: detail,
      high: decision.highCount,
      heuristic: decision.heuristicCount,
      unscanned: decision.unscannedCount,
      rules: decision.rules.join(','),
      decisionId: decision.decisionId,
    },
  })
}

export type SecretPublicationGate = {
  /** Whether the owner turned blocking on for this node. */
  enabled(): Promise<boolean>
  /** Null to proceed. A refusal when blocking is on and the report has a high-confidence finding or
   *  is incomplete, unless the owner allowed this exact operation; that allowance is spent here. */
  admit(input: {
    operation: SecretPublicationOperation
    destination: string
    report: SecretCheckReport
  }): Promise<SecretPublicationRefusal | null>
}

export function createSecretPublicationGate(deps: {
  db: AppDatabase
  prefs: PrefService
  identity: IdentityService
}): SecretPublicationGate {
  const enabled = async () => {
    const userId = deps.identity.active()
    return !!userId && (await deps.prefs.read(userId, SECRET_PUBLICATION_PREF_KEY)) === 'true'
  }
  return {
    enabled,
    admit: async ({ operation, destination: named, report }) => {
      if (!report.counts.high && report.complete) return null
      if (!(await enabled())) return null
      // A remote URL can carry a user and token. Settings and the audit trail show this string.
      const destination = named.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/gi, '$1')
      const now = Date.now()
      prune(now)
      const id = decisionId(operation, destination, report)
      const existing = decisions.get(id)
      if (existing?.allowed) {
        decisions.delete(id)
        audit(deps.db, { actor: 'system' }, existing, 'secrets.publication.allowed', 'used')
        return null
      }
      const decision: SecretPublicationDecision = {
        decisionId: id,
        operation,
        destination,
        reason: report.counts.high ? 'findings' : 'incomplete',
        highCount: report.counts.high,
        heuristicCount: report.counts.heuristic,
        unscannedCount: report.unscanned.length,
        rules: [...new Set(report.findings.map((finding) => finding.rule))].sort(),
        createdAt: now,
        expiresAt: now + SECRET_DECISION_TTL_MS,
        allowed: false,
      }
      decisions.delete(id)
      decisions.set(id, decision)
      prune(now)
      audit(deps.db, { actor: 'system' }, decision, 'secrets.publication.blocked', 'blocked')
      return { decisionId: id, operation, reason: decision.reason, report }
    },
  }
}

/** Pending and allowed decisions, newest first, for Settings. */
export function secretPublicationDecisions(now = Date.now()): SecretPublicationDecision[] {
  prune(now)
  return [...decisions.values()].reverse()
}

/** Allow one refused operation once. Device route only. False when it expired or never existed. */
export function allowSecretPublication(db: AppDatabase, actor: AuditActor, id: string, now = Date.now()): boolean {
  prune(now)
  const decision = decisions.get(id)
  if (!decision || decision.allowed) return !!decision
  decision.allowed = true
  decision.expiresAt = now + SECRET_DECISION_TTL_MS
  audit(db, actor, decision, 'secrets.publication.allowed', 'allowed')
  return true
}

const VERBS: Record<SecretPublicationOperation, string> = {
  commit: 'commit',
  push: 'push',
  export: 'export',
  send: 'message',
}

/** One readable refusal: rule ids and positions, never content. `remedy` names the safer path the
 *  caller offers, such as a redacted export. */
export function describeSecretRefusal(
  refusal: SecretPublicationRefusal,
  remedy = 'Remove the secret and try again',
): string {
  const { report } = refusal
  const verb = VERBS[refusal.operation]
  const shown = report.findings
    .filter((finding) => finding.confidence === 'high')
    .slice(0, 3)
    .map((finding) => `${finding.rule} at ${finding.location}:${finding.line}`)
  const what =
    refusal.reason === 'findings'
      ? `${report.counts.high} likely secret${report.counts.high === 1 ? '' : 's'} (${shown.join(', ')}${report.counts.high > shown.length ? ', …' : ''})`
      : `an incomplete check (${report.unscanned[0] ? `${report.unscanned[0].location}: ${report.unscanned[0].reason}` : 'not every input was read'})`
  return `The secret check blocked this ${verb}: ${what}. ${remedy}, or allow this exact ${verb} once in Settings > Security and backup.`
}

/** @internal tests only. */
export const resetSecretPublicationDecisions = (): void => decisions.clear()
