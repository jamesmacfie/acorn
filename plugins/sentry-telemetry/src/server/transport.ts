// Putting one envelope on the wire, and reading what Sentry says back.
//
// Two things come back that matter more than the status code. `X-Sentry-Rate-Limits` can appear on
// any response, including a 200, and names which quota categories are closed and for how long. And
// `X-Sentry-Error` carries Relay's own sentence about a rejected envelope, which is the difference
// between "400" and "the log item declared item_count 5 and carried 4".
import type { SentryDataCategory, SentryEnvelope } from './envelope'
import { serializeEnvelope } from './envelope'
import { authHeader, envelopeEndpoint, type SentryDsn } from './dsn'

export type FetchLike = typeof fetch

/** A closed quota. `categories: 'all'` is the header's empty-category form, and what a bare
 *  `Retry-After` on a 429 means. */
export type RateLimit = { categories: SentryDataCategory[] | 'all'; untilMs: number }

export type PostResult = {
  /** Null for a network failure, which is the case worth retrying. */
  status: number | null
  limits: RateLimit[]
  /** Relay's own explanation of a rejected envelope, when it sent one. */
  detail: string | null
}

const CATEGORIES = new Set<string>(['error', 'transaction', 'log_item', 'trace_metric', 'monitor'])

/**
 * Parse `X-Sentry-Rate-Limits`.
 *
 * The grammar is comma-separated quotas, each `retry_after:categories:scope:reason:namespaces`,
 * with categories separated by semicolons and whitespace to be ignored anywhere. A quota naming
 * only categories this exporter does not know is skipped, which the specification asks for by name:
 * a future category must not close the ones in front of it.
 */
export function parseRateLimits(header: string | null | undefined, now: number): RateLimit[] {
  if (!header) return []
  const limits: RateLimit[] = []
  for (const quota of header.split(',')) {
    const [rawSeconds, rawCategories] = quota.split(':')
    const seconds = Number(rawSeconds?.trim())
    if (!Number.isFinite(seconds) || seconds < 0) continue
    const untilMs = now + seconds * 1_000
    const named = (rawCategories ?? '').split(';').map((entry) => entry.trim().toLowerCase()).filter(Boolean)
    if (!named.length) {
      limits.push({ categories: 'all', untilMs })
      continue
    }
    const known = named.filter((entry) => CATEGORIES.has(entry)) as SentryDataCategory[]
    // Every category unknown means this quota is about something this exporter never sends.
    if (known.length) limits.push({ categories: known, untilMs })
  }
  return limits
}

/** `Retry-After` is seconds or an HTTP date. Sentry sends seconds; the date form is handled because
 *  a proxy in front of a self-hosted install may rewrite it. */
function retryAfterMs(header: string | null | undefined, now: number): number | null {
  if (!header) return null
  const seconds = Number(header.trim())
  if (Number.isFinite(seconds)) return seconds * 1_000
  const date = Date.parse(header)
  return Number.isFinite(date) ? Math.max(0, date - now) : null
}

/** How long a 429 with no useful header closes everything for. The specification's own default. */
const DEFAULT_LIMIT_MS = 60_000

export async function postEnvelope(options: {
  fetch: FetchLike
  dsn: SentryDsn
  envelope: SentryEnvelope
  client: string
  sdk: { name: string; version: string }
  now: number
  signal?: AbortSignal
}): Promise<PostResult> {
  const body = serializeEnvelope(options.envelope, {
    // Both auth forms, and they agree. The header is what every Sentry SDK sends and what an older
    // self-hosted Relay understands; the envelope header is what makes a captured envelope
    // replayable on its own.
    dsn: `${options.dsn.protocol}://${options.dsn.publicKey}@${options.dsn.host}/${options.dsn.path ? `${options.dsn.path}/` : ''}${options.dsn.projectId}`,
    sdk: options.sdk,
    sent_at: new Date(options.now).toISOString(),
  })
  let response: Response
  try {
    response = await options.fetch(envelopeEndpoint(options.dsn), {
      method: 'POST',
      headers: {
        'content-type': 'application/x-sentry-envelope',
        'x-sentry-auth': authHeader(options.dsn, options.client),
        'user-agent': options.client,
      },
      body,
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    })
  } catch {
    // A closed laptop, a dropped VPN, a DNS answer that has not come back. The caller retries this
    // one and only this one.
    return { status: null, limits: [], detail: null }
  }
  const limits = parseRateLimits(response.headers.get('x-sentry-rate-limits'), options.now)
  if (response.status === 429 && !limits.length) {
    const after = retryAfterMs(response.headers.get('retry-after'), options.now) ?? DEFAULT_LIMIT_MS
    limits.push({ categories: 'all', untilMs: options.now + after })
  }
  return { status: response.status, limits, detail: response.headers.get('x-sentry-error') }
}
