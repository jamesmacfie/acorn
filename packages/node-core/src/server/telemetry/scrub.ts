// The last thing a message passes through before it can leave the machine.
//
// Core's own copy of the rules `plugins/agents/src/server/drivers/diagnostics.ts`
// (`safeProviderMessage`) applies to provider output. A copy rather than a shared module because
// core cannot import a plugin, and the plugin's version carries a list of live secrets this one has
// no way to see. The patterns are the same, and a change to either belongs in both.
//
// Three passes, in this order: control characters out, the two absolute roots collapsed,
// credential-shaped runs replaced, then the cap. Roots go before tokens so a token sitting inside a
// path is still caught by the token pass.
//
// What this deliberately does not do is shorten every absolute path it sees. A route pattern
// (`/v2/core/tasks/:id`), a channel name and a plugin namespace are all slash-shaped, and a
// scrubber that collapsed them would make every log line and every span attribute unreadable to buy
// nothing: the paths worth hiding are the owner's home directory and the data root, and those two
// are named (docs/telemetry.md § What never leaves the machine).
import { homedir } from 'node:os'
import { LOG_BODY_MAX } from '@acorn/protocol/telemetry.ts'

const TOKEN_PATTERNS = [
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /\b((?:authorization|api[-_ ]?key|token|password|secret)\s*[:=]\s*)\S+/gi,
]

// Everything except tab, newline and carriage return. A record travels through JSON, a log file and
// somebody's terminal, and a raw escape sequence in any of those is a way to write over what the
// reader already saw.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

// Set once at boot from the composition root, so a path under the data root reads as `<data>` in
// every record. Unset in a plain unit test, which only costs that test the collapse.
let dataRoot: string | null = null

export function setTelemetryDataRoot(dir: string | null): void {
  dataRoot = dir && dir.length > 1 ? dir.replace(/\/+$/, '') : null
}

/** Longest first, so `<data>` wins over `~` when the data root sits inside the home directory, which
 *  it does on every machine acorn has run on. */
const roots = (): Array<[string, string]> => {
  const home = homedir()
  const pairs: Array<[string, string]> = []
  if (dataRoot) pairs.push([dataRoot, '<data>'])
  if (home && home.length > 1) pairs.push([home.replace(/\/+$/, ''), '~'])
  return pairs.sort((a, b) => b[0].length - a[0].length)
}

/** Collapse the two absolute prefixes a record is allowed to mention. A worktree path is under the
 *  data root, so this is also what turns `/Users/sam/.acorn/worktrees/acorn-42/src/x.ts` into
 *  `<data>/worktrees/acorn-42/src/x.ts`: the repo-relative part survives and the person's disk
 *  layout does not. */
export function collapseRoots(value: string): string {
  let out = value
  for (const [prefix, replacement] of roots()) out = out.replaceAll(prefix, replacement)
  return out
}

/**
 * A string safe to put on a record: no control characters, no absolute roots, no credentials, and
 * at most `max` characters.
 *
 * Never throws and always answers with a string. Telemetry must not fail the thing it describes, and
 * a scrubber that threw on an odd input would do exactly that at the one call site nobody tests.
 */
export function scrub(value: unknown, fallback = '', max = LOG_BODY_MAX): string {
  let message: string
  try {
    message = typeof value === 'string' ? value : value instanceof Error ? value.message : String(value ?? '')
  } catch {
    // A thrown `toString`, which an object built from a proxy can do.
    return fallback
  }
  message = collapseRoots(message.replace(CONTROL, ''))
  for (const pattern of TOKEN_PATTERNS) {
    // Only the last pattern has a capture group. `typeof` and not a truthiness check, because for a
    // pattern with no groups the replacer's second argument is the match offset, and a token that
    // happened to sit at index 6 would come back as `6<redacted>`. The copy in
    // `plugins/agents/src/server/drivers/diagnostics.ts` had that bug.
    message = message.replace(pattern, (_match, prefix?: unknown) =>
      typeof prefix === 'string' ? `${prefix}<redacted>` : '<redacted>')
  }
  const bounded = message.trim().slice(0, max)
  return bounded || fallback
}
