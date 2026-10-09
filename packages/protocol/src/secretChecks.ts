// Secret checks before publication (docs/security/secret-publication.md). The detector and the gate
// live on the node (packages/node-core/src/server/secretChecks/); these are the shapes every caller
// and client reads. No field ever holds a matched value or the line around it.

/** `high` is a documented provider token or private-key shape. `heuristic` is an assignment, a URL
 *  password, or a JWT: worth a look, never proof of a live credential. */
export type SecretConfidence = 'high' | 'heuristic'

export type SecretFinding = {
  rule: string
  confidence: SecretConfidence
  /** A repo path, blob id, attachment id, or export name. Never content. */
  location: string
  line: number
  column: number
}

/** Input the check could not read: a binary attachment, a blob over its size limit, a range Git
 *  could not resolve. An enabled gate treats any of these as incomplete. */
export type SecretUnscanned = { location: string; reason: string }

export type SecretCheckReport = {
  detectorVersion: string
  /** sha256 over the exact bytes and operation identity this report covers. */
  digest: string
  findings: SecretFinding[]
  /** Exact totals, even when `findings` is truncated. */
  counts: Record<SecretConfidence, number>
  /** More findings than the report keeps. */
  truncated: boolean
  unscanned: SecretUnscanned[]
  /** False when anything was unscanned or the check stopped early. */
  complete: boolean
  /** Plain-language limits of this check, shown beside the findings. */
  limits: string[]
}

export type SecretPublicationOperation = 'commit' | 'push' | 'export' | 'send'

/** What an enabled gate returns when it refuses. `decisionId` is what the device allows once. */
export type SecretPublicationRefusal = {
  decisionId: string
  operation: SecretPublicationOperation
  reason: 'findings' | 'incomplete'
  report: SecretCheckReport
}

/** A refused operation waiting for the owner, as Settings lists it. */
export type SecretPublicationDecision = {
  decisionId: string
  operation: SecretPublicationOperation
  /** Remote and ref, worktree and branch, session, or provider. Never content. */
  destination: string
  reason: SecretPublicationRefusal['reason']
  highCount: number
  heuristicCount: number
  unscannedCount: number
  rules: string[]
  createdAt: number
  expiresAt: number
  allowed: boolean
}

export type SecretPublicationState = {
  block: boolean
  detectorVersion: string
  decisions: SecretPublicationDecision[]
}

export const coreSecretPublicationRoute = '/v1/core/security/secret-publication'
export const coreSecretPublicationAllowRoute = '/v1/core/security/secret-publication/allow'
/** The core preference that turns blocking on. Written only through the device route above. */
export const SECRET_PUBLICATION_PREF_KEY = 'security.secretPublication.block'
