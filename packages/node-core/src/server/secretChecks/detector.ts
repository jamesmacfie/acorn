// The local secret detector (docs/security/secret-publication.md § Detector). Pure: no network, no
// token validation, no model. Changes and agents reach it through @acorn/plugin-api/node.
//
// A small rule table of our own rather than Gitleaks or secretlint. Gitleaks is a Go binary that
// would need a signed sidecar per platform. secretlint missed a bare AWS key id and a key header in
// our fixtures, has no confidence tiers, and puts the matched value into every message it returns.
// Each rule below is a documented provider prefix with a fixture in detector.test.ts. Raise
// SECRET_DETECTOR_VERSION whenever a rule changes, because allowances and caches bind to it.
import type {
  SecretCheckReport,
  SecretConfidence,
  SecretFinding,
  SecretUnscanned,
} from '@acorn/protocol/secretChecks.ts'

export const SECRET_DETECTOR_VERSION = 'acorn-secrets/1'

/** How many findings one report keeps. Counts past this set `truncated`, never drop silently. */
export const MAX_SECRET_FINDINGS = 200

type Rule = { id: string; confidence: SecretConfidence; pattern: RegExp; value?: number }

// `value` names the capture group holding the secret part, for rules whose match includes a key
// name or a URL around it. Every pattern is linear: no nested quantifiers.
const RULES: readonly Rule[] = [
  { id: 'private-key', confidence: 'high', pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g },
  { id: 'aws-access-key-id', confidence: 'high', pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16}\b/g },
  {
    id: 'github-token',
    confidence: 'high',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59})\b/g,
  },
  { id: 'gitlab-token', confidence: 'high', pattern: /\bglpat-[A-Za-z0-9_-]{20}\b/g },
  { id: 'slack-token', confidence: 'high', pattern: /\bxox[abposr]-[0-9]{8,13}-[A-Za-z0-9-]{8,}\b/g },
  {
    id: 'slack-webhook',
    confidence: 'high',
    pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{8,}\/B[A-Z0-9]{8,}\/[A-Za-z0-9]{24}/g,
  },
  { id: 'stripe-secret-key', confidence: 'high', pattern: /\b[sr]k_live_[A-Za-z0-9]{24,}\b/g },
  { id: 'anthropic-api-key', confidence: 'high', pattern: /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{80,}/g },
  {
    id: 'openai-api-key',
    confidence: 'high',
    pattern: /\bsk-(?:(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,}|[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20})/g,
  },
  { id: 'google-api-key', confidence: 'high', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'npm-token', confidence: 'high', pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  // Heuristics: they warn and never block on their own.
  {
    id: 'jwt',
    confidence: 'heuristic',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
  {
    id: 'url-password',
    confidence: 'heuristic',
    pattern: /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s/:@'"]{1,64}:([^\s/@'"]{6,128})@/g,
    value: 1,
  },
  {
    id: 'credential-assignment',
    confidence: 'heuristic',
    pattern:
      /\b[A-Za-z0-9_.-]{0,40}(?:api[_-]?key|secret|token|passw(?:or)?d|credential|auth)[A-Za-z0-9_.-]{0,40}['"]?\s{0,4}[:=]\s{0,4}['"]([^'"\s]{12,200})['"]/gi,
    value: 1,
  },
]

// Narrow content rules for documented placeholders, never whole directories: AWS's own EXAMPLE keys,
// runs of one character, and template slots. A fixture that looks real is reported, which is the point.
const PLACEHOLDER = /EXAMPLE|(.)\1{7,}|^(?:your|my|<|\$\{|\{\{|%\()|changeme|placeholder|redacted/i

// Bits per character, for the assignment heuristic only. A long readable word is not a secret.
function entropy(value: string): number {
  const counts = new Map<string, number>()
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1)
  let bits = 0
  for (const count of counts.values()) bits -= (count / value.length) * Math.log2(count / value.length)
  return bits
}

type Match = { rule: Rule; order: number; start: number; end: number }

function matches(text: string): Match[] {
  const found: Match[] = []
  RULES.forEach((rule, order) => {
    for (const match of text.matchAll(rule.pattern)) {
      const value = match[rule.value ?? 0] ?? match[0]
      if (PLACEHOLDER.test(value)) continue
      if (rule.id === 'credential-assignment' && entropy(value) < 3.5) continue
      const start = match.index + (rule.value ? match[0].lastIndexOf(value) : 0)
      found.push({ rule, order, start, end: start + value.length })
    }
  })
  // One finding per span. Where two rules cover the same text, the earlier rule in the table, the
  // more specific one, names it: `auth = "eyJ…"` is a JWT, not also an assignment.
  found.sort((a, b) => a.start - b.start || a.order - b.order)
  const out: Match[] = []
  for (const match of found) if (!out.length || match.start >= out.at(-1)!.end) out.push(match)
  return out
}

/** Every finding in one text, by rule and position. The matched value never leaves this function. */
export function scanSecretText(text: string, location: string): SecretFinding[] {
  const found = matches(text)
  if (!found.length) return []
  // Line starts once per text, so a position lookup is a binary search rather than a rescan.
  const lineStarts = [0]
  for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) lineStarts.push(at + 1)
  return found.map(({ rule, start }) => {
    let low = 0
    let high = lineStarts.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (lineStarts[mid]! <= start) low = mid
      else high = mid - 1
    }
    return { rule: rule.id, confidence: rule.confidence, location, line: low + 1, column: start - lineStarts[low]! + 1 }
  })
}

export const SECRET_REDACTION = '[redacted secret]'

/** The text with every finding replaced by one fixed marker. Used for the redacted export. */
export function redactSecretText(text: string): string {
  let out = ''
  let at = 0
  for (const { start, end } of matches(text)) {
    out += text.slice(at, start) + SECRET_REDACTION
    at = end
  }
  return out + text.slice(at)
}

/** Decode one input for scanning: strict UTF-8, no NUL bytes, within its limit. Anything else is
 *  reported unscanned rather than guessed at. */
export function decodeSecretInput(bytes: Uint8Array, maxBytes: number): { text: string } | { unscanned: string } {
  if (bytes.byteLength > maxBytes) return { unscanned: `Larger than ${Math.round(maxBytes / 1024)} KiB.` }
  if (bytes.includes(0)) return { unscanned: 'Binary content.' }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch {
    return { unscanned: 'Not valid UTF-8.' }
  }
}

/** One report from findings gathered across many inputs. */
export function secretReport(input: {
  digest: string
  findings: readonly SecretFinding[]
  unscanned?: readonly SecretUnscanned[]
  stopped?: boolean
  limits?: readonly string[]
}): SecretCheckReport {
  const unscanned = [...(input.unscanned ?? [])]
  // High-confidence findings first, so a truncated report still names what blocks.
  const ordered = [...input.findings].sort((a, b) =>
    a.confidence === b.confidence ? 0 : a.confidence === 'high' ? -1 : 1,
  )
  return {
    detectorVersion: SECRET_DETECTOR_VERSION,
    digest: input.digest,
    findings: ordered.slice(0, MAX_SECRET_FINDINGS),
    counts: {
      high: ordered.filter((finding) => finding.confidence === 'high').length,
      heuristic: ordered.filter((finding) => finding.confidence === 'heuristic').length,
    },
    truncated: ordered.length > MAX_SECRET_FINDINGS,
    unscanned: unscanned.slice(0, MAX_SECRET_FINDINGS),
    complete: !unscanned.length && !input.stopped,
    limits: [...(input.limits ?? [])],
  }
}
