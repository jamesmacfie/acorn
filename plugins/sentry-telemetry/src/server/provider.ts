// The connection that holds the DSN.
//
// A `ConnectionProviderContribution` and not an `IntegrationProviderContribution`: this plugin
// mirrors nothing, browses nothing and promotes nothing to a task. It owns a credential and spends
// it. That gets the Settings → Integrations form, encryption under the node's key, the
// `secret.created` audit row, and connect, test, rotate and disconnect, with no core code
// (docs/integrations.md § Connection and integration contributions).
//
// The DSN is the whole credential. An organisation token, which is what release health and
// source-map upload need, is deliberately not asked for: neither is in scope, and a token that
// could read and write the owner's whole Sentry organisation is a different thing to disclose.
import { ProviderOperationError, publicConnectionProvider } from '@acorn/plugin-api/node'
import { PROVIDER_ID } from '../shared/settings'
import { describeDsn, parseDsn, type SentryDsn } from './dsn'
import { probeEnvelope } from './envelope'
import { postEnvelope, type FetchLike } from './transport'

export type SentryValidated = { dsn: SentryDsn; environment: string; release: string }

/** What `config` holds on the connection row: non-secret, provider-owned, and read back on every
 *  flush. A staging project is a second row rather than a mode, because these live here. */
export type SentryConnectionConfig = { host: string; projectId: string; environment: string; release: string }

const trimmed = (value: string | undefined): string => (value ?? '').trim()

/** Core's `ConnectionHealth`, written out because the type is not on the plugin API surface. The
 *  four codes below are the ones an ingestion endpoint can distinguish. */
type Health =
  | { ok: true }
  | { ok: false; error: 'provider_needs_auth' | 'provider_rate_limited' | 'provider_resource_not_found' | 'provider_bad_config' | 'provider_unavailable' }

/** Post an envelope with a header and no items. Sentry stores nothing and answers 200, so a
 *  connection test costs the owner no quota and puts no invented event in their issue list. */
async function probe(fetchImpl: FetchLike, dsn: SentryDsn, client: string, sdk: { name: string; version: string }): Promise<Health> {
  const result = await postEnvelope({ fetch: fetchImpl, dsn, envelope: probeEnvelope(), client, sdk, now: Date.now() })
  if (result.status === null) return { ok: false, error: 'provider_unavailable' }
  if (result.status === 401 || result.status === 403) return { ok: false, error: 'provider_needs_auth' }
  if (result.status === 404) return { ok: false, error: 'provider_resource_not_found' }
  if (result.status === 429) return { ok: false, error: 'provider_rate_limited' }
  if (result.status >= 400) return { ok: false, error: 'provider_bad_config' }
  return { ok: true }
}

export function createSentryTelemetryProvider(options: {
  fetch?: FetchLike
  client: string
  sdk: { name: string; version: string }
}) {
  const fetchImpl = options.fetch ?? fetch
  return publicConnectionProvider<SentryValidated>({
    id: PROVIDER_ID,
    label: 'Sentry (telemetry export)',
    // This plugin's own mark, registered by the host from `icon` in acorn-plugin.config.mjs. The
    // issue-reading `sentry` integration will carry the same one, which is deliberate: two
    // providers, two credentials, two reasons to install (docs/integrations.md § Sentry).
    glyph: `brand:${PROVIDER_ID}`,
    kind: 'observability',
    connection: {
      authKind: 'api-key',
      connectable: true,
      disconnectable: true,
      // One. The exporter spends the first usable row, so a second would be a connection that
      // silently received nothing. Point this at staging by editing the row's environment rather
      // than by adding another.
      maxConnections: 1,
      fields: [
        {
          id: 'dsn',
          label: 'DSN',
          type: 'password',
          placeholder: 'https://…@o0.ingest.sentry.io/0',
          hint: 'Sentry → Settings → Projects → your project → Client Keys. The DSN stays encrypted on this machine.',
          required: true,
        },
        {
          id: 'environment',
          label: 'Environment',
          type: 'text',
          placeholder: 'development',
          hint: 'Tags everything this node sends. Sentry defaults it to production when it is blank.',
          required: false,
        },
        {
          id: 'release',
          label: 'Release',
          type: 'text',
          placeholder: 'acorn@0.1.0',
          hint: 'Optional. No source maps are uploaded, so this only groups what you send.',
          required: false,
        },
      ],
      async validate(credentials) {
        const dsn = parseDsn(trimmed(credentials.dsn))
        // A DSN that does not parse is the owner's typo, and the form is the right place to say so.
        if (!dsn) throw new ProviderOperationError('provider_bad_config', 400)
        const health = await probe(fetchImpl, dsn, options.client, options.sdk)
        if (!health.ok) {
          throw new ProviderOperationError(
            health.error,
            health.error === 'provider_needs_auth' ? 401 : health.error === 'provider_rate_limited' ? 429 : health.error === 'provider_bad_config' ? 400 : 502,
          )
        }
        return { dsn, environment: trimmed(credentials.environment), release: trimmed(credentials.release) }
      },
      normalize(credentials, validated) {
        const config: SentryConnectionConfig = {
          host: validated.dsn.host,
          projectId: validated.dsn.projectId,
          environment: validated.environment,
          release: validated.release,
        }
        return {
          secret: trimmed(credentials.dsn),
          label: `Sentry · ${describeDsn(validated.dsn)}`,
          account: null,
          scopes: [],
          config,
          capabilities: {},
        }
      },
      async test(secret) {
        const dsn = parseDsn(secret)
        if (!dsn) return { ok: false, error: 'provider_bad_config' }
        return probe(fetchImpl, dsn, options.client, options.sdk)
      },
    },
    // Nothing in the shared capability vocabulary describes "receives telemetry". A sink browses
    // nothing, resolves nothing and mutates nothing, so claiming any of them would put a row in
    // Settings that promises a surface this plugin does not draw.
    capabilities: {},
    budgets: { maxConcurrentRequests: 2, maxConcurrentRequestsPerConnection: 1 },
  })
}

/** Read `environment` and `release` back off a stored connection. Written by `normalize`, so a row
 *  that predates a field simply answers with an empty string. */
export function connectionConfig(raw: string | null | undefined): { environment: string; release: string } {
  try {
    const parsed: unknown = JSON.parse(raw || '{}')
    if (typeof parsed !== 'object' || parsed === null) return { environment: '', release: '' }
    const record = parsed as Record<string, unknown>
    return {
      environment: typeof record.environment === 'string' ? record.environment : '',
      release: typeof record.release === 'string' ? record.release : '',
    }
  } catch {
    return { environment: '', release: '' }
  }
}
