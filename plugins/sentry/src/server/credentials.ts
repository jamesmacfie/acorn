// Where a Sentry credential comes from: a connection made in Settings, or the environment that
// started the node. A connection wins (docs/integrations/sentry.md § Credentials from the environment).
import { isRecord, parseJson } from '@acorn/plugin-api/node'
import { ENV_CONNECTION_ID } from '../shared/api'
import { DEFAULT_SENTRY_URL, sentryHost, type SentryCredential } from './api'

/** One credential the routes can read with, and the connection id its rail rows carry. */
export type SentryTarget = SentryCredential & { connectionId: string; label: string }

/** What `normalize` writes into a connection's `config`. */
export type SentryConnectionConfig = { organization: string; project: string; host: string; projectId: string }

/** Read back from the stored row's JSON text, or from the object core hands `test`. */
export function connectionConfig(raw: unknown): SentryConnectionConfig | null {
  const config = typeof raw === 'string' ? parseJson(raw) : raw
  if (!isRecord(config)) return null
  const { organization, project, host, projectId } = config
  return typeof organization === 'string' &&
    typeof project === 'string' &&
    typeof host === 'string' &&
    typeof projectId === 'string'
    ? { organization, project, host, projectId }
    : null
}

const TOKEN = 'ACORN_SENTRY_TOKEN'
const ORG = 'ACORN_SENTRY_ORG'
const PROJECT = 'ACORN_SENTRY_PROJECT'
const URL_VARIABLE = 'ACORN_SENTRY_URL'

/**
 * The environment's credential, or null when it counts as unset. The token, the organization, and the
 * project must all be set. A warning names the variables at fault and never a value.
 */
export function readEnvironment(env: Record<string, string | undefined>): {
  target: SentryTarget | null
  warning?: string
} {
  const token = env[TOKEN]?.trim() ?? ''
  const organization = env[ORG]?.trim() ?? ''
  const project = env[PROJECT]?.trim() ?? ''
  if (!token && !organization && !project) return { target: null }
  if (!token || !organization || !project) {
    return { target: null, warning: `Set all of ${TOKEN}, ${ORG}, and ${PROJECT} to read Sentry issues` }
  }
  const host = sentryHost(env[URL_VARIABLE]?.trim() || DEFAULT_SENTRY_URL)
  if (!host) {
    return { target: null, warning: `${URL_VARIABLE} must be https://sentry.io or https://de.sentry.io` }
  }
  return {
    target: {
      connectionId: ENV_CONNECTION_ID,
      label: `Sentry · ${organization}/${project} (from ${TOKEN})`,
      token,
      host,
      organization,
      project,
    },
  }
}
