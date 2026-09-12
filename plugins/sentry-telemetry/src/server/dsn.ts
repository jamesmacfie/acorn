// A Sentry DSN, taken apart.
//
// The DSN is the whole credential for ingestion: it names the protocol, the public key, the host,
// an optional path prefix for a self-hosted install behind a sub-path, and the numeric project id.
// Nothing else authenticates an envelope, which is why the field is a password field and why the
// exporter never logs the parsed value.
//
// No acorn imports, on purpose. This file and ./envelope.ts are the two that speak Sentry and
// nothing else, so a second Sentry-speaking plugin can take them as they are.

export type SentryDsn = {
  /** `https` or `http`. A self-hosted install on a private network may be plain. */
  protocol: 'http' | 'https'
  publicKey: string
  /** Host and port, as the URL carried them. */
  host: string
  /** Everything between the host and the project id, without slashes. Empty for sentry.io. */
  path: string
  projectId: string
}

/** How the DSN reads in the connection label and on the settings page. Never the key. */
export const describeDsn = (dsn: SentryDsn): string => `${dsn.host}/${dsn.projectId}`

/**
 * Parse a DSN, or answer null.
 *
 * Null rather than a throw, because both callers want to say their own thing about it: the
 * provider's `validate` raises a bad-config error the settings form renders, and the exporter drops
 * a connection it cannot read rather than failing a flush.
 */
export function parseDsn(raw: string): SentryDsn | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!url.username) return null
  // `password` is the legacy secret key half. Sentry stopped requiring it in 2016 and ignores it on
  // ingestion, so a DSN that still carries one parses and the secret is dropped here.
  const segments = url.pathname.split('/').filter(Boolean)
  const projectId = segments.pop()
  // Numeric, because the endpoint below is `/api/<project_id>/envelope/` and a project *slug* there
  // is a 404 nobody sees: ingestion answers the same 200 shape for most bad input.
  if (!projectId || !/^\d+$/.test(projectId)) return null
  return {
    protocol: url.protocol === 'https:' ? 'https' : 'http',
    publicKey: url.username,
    host: url.host,
    path: segments.join('/'),
    projectId,
  }
}

/** Where an envelope goes. The trailing slash is Sentry's, and a request without it redirects. */
export const envelopeEndpoint = (dsn: SentryDsn): string =>
  `${dsn.protocol}://${dsn.host}/${dsn.path ? `${dsn.path}/` : ''}api/${dsn.projectId}/envelope/`

/**
 * The `X-Sentry-Auth` header.
 *
 * The DSN also travels in the envelope header, and either alone is enough. Both are sent: the
 * header is what Sentry's own SDKs use and what its relays read first, and the envelope header is
 * what makes a stored envelope replayable.
 */
export const authHeader = (dsn: SentryDsn, client: string): string =>
  `Sentry sentry_version=7, sentry_client=${client}, sentry_key=${dsn.publicKey}`
