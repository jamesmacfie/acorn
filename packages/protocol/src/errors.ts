import { z } from 'zod'

// The one error envelope every route returns (docs/api-reference.md § Errors):
//
//   { "error": { "code", "message", "requestId", "retryable", "details"? } }
//
// Error bodies never carry secrets, tokens, file contents or provider response bodies; unknown
// internal failures return `internal` plus a requestId and log the rest server-side.

// Transport-level codes: the floor every consumer can rely on, used verbatim for failures that have
// no domain meaning.
//
// docs/api-reference.md calls this "a small closed set". It is the closed *floor*, not an exclusive whitelist,
// and the deviation is deliberate: 37 domain codes are already load-bearing on the client — a
// `needs-trust` opens the config-trust modal, `provider_needs_auth` rewrites the message — so
// collapsing them all into ten would delete real behaviour. A closed set buys interop discipline
// across an API boundary, and there isn't one here: client and Node ship from the same repo and are
// released together (docs/api-reference.md § Versioning). So a route may return its own documented code, and
// anything without one falls back to these.
export const ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'revision_conflict',
  'idempotency_conflict',
  'provider_error',
  'rate_limited',
  'timeout',
  'internal',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

// `ErrorCode | (string & {})` keeps autocomplete on the closed floor while still accepting a
// route's own documented code.
export type ErrorCodeOrDomain = ErrorCode | (string & {})

// A client-supplied X-Request-Id is echoed when it matches this grammar, else replaced. Bounded and
// charset-restricted so an attacker-controlled header cannot inject into logs or response headers.
export const requestIdSchema = z.string().regex(/^[A-Za-z0-9._-]{1,128}$/)

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    // Human/upstream prose (e.g. GitHub's verbatim 422 reason). Never a stack, SQL or path.
    message: z.string(),
    requestId: z.string(),
    // Whether an identical retry could plausibly succeed. Derived from the status, so callers never
    // have to maintain a per-code table.
    retryable: z.boolean(),
    details: z.unknown().optional(),
  }),
})

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>

// The name every existing call site uses for this shape.
export type ApiError = ErrorEnvelope

// Statuses where an identical retry can plausibly succeed. 5xx is deliberately excluded apart from
// the two "come back later" codes: a 500 usually means the request itself is broken, and marking it
// retryable invites clients to hammer it.
const RETRYABLE_STATUS = new Set([408, 429, 502, 503, 504])

export const statusIsRetryable = (status: number): boolean => RETRYABLE_STATUS.has(status)

// Fallback code for a status when the caller supplies none.
export function codeForStatus(status: number): ErrorCode {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 408 || status === 504) return 'timeout'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'internal'
  return 'bad_request'
}
