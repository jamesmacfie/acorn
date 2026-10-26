// The Settings connection that holds a Sentry auth token.
//
// A `ConnectionProviderContribution`, not an integration one: this plugin reads issues live and
// mirrors nothing, so it needs the connection form, encryption, and the project map, and none of the
// item cache (docs/integrations/contributions.md § Connection and integration contributions).
import {
  isProviderOperationError,
  type ProviderProjectSource,
  ProviderOperationError,
  publicConnectionProvider,
} from '@acorn/plugin-api/node'
import {
  DEFAULT_SENTRY_URL,
  projectPath,
  sentryFetch,
  sentryHost,
  type SentryApiProject,
  type SentryCredential,
} from './api'
import { connectionConfig, type SentryConnectionConfig } from './credentials'

type SentryValidated = SentryCredential & { projectId: string }

// One project, always. `normalize` writes it onto the connection when the token is checked, so the
// workspace map has a row to select and listing it makes no call.
const sentryProjectSource: ProviderProjectSource = {
  list({ connection }) {
    const config = connectionConfig(connection.config)
    return Promise.resolve(config ? [{ id: config.projectId, label: connection.label }] : [])
  },
}

/** Read the project once. Every field the form asks for has to be right for this to answer. */
async function checkProject(credential: SentryCredential): Promise<SentryApiProject> {
  let response: Response
  try {
    response = await sentryFetch(credential, projectPath(credential))
  } catch {
    throw new ProviderOperationError('provider_unavailable', 502)
  }
  if (response.status === 401 || response.status === 403) throw new ProviderOperationError('provider_needs_auth', 401)
  if (response.status === 404) {
    throw new ProviderOperationError(
      'provider_resource_not_found',
      404,
      `Sentry has no project ${credential.organization}/${credential.project} that this token can read.`,
    )
  }
  if (!response.ok) throw new ProviderOperationError('provider_unavailable', 502)
  const project = (await response.json()) as SentryApiProject
  return { id: String(project.id), slug: project.slug, ...(project.name ? { name: project.name } : {}) }
}

export const sentryProvider = publicConnectionProvider<SentryValidated>({
  id: 'sentry',
  label: 'Sentry',
  glyph: 'brand:sentry',
  kind: 'error-tracker',
  connection: {
    authKind: 'api-key',
    connectable: true,
    disconnectable: true,
    fields: [
      {
        id: 'token',
        label: 'Auth token',
        type: 'password',
        placeholder: 'sntryu_…',
        hint: 'Sentry → Settings → Personal Tokens, with event:read and project:read. acorn stores it encrypted.',
        required: true,
      },
      { id: 'organization', label: 'Organization slug', type: 'text', placeholder: 'acme', required: true },
      {
        id: 'project',
        label: 'Project slug',
        type: 'text',
        placeholder: 'web',
        hint: 'One connection per project.',
        required: true,
      },
      {
        id: 'url',
        label: 'Sentry address',
        type: 'url',
        placeholder: DEFAULT_SENTRY_URL,
        hint: 'Leave it blank for the US region. Use https://de.sentry.io for the EU region.',
        required: false,
      },
    ],
    async validate(credentials) {
      const token = credentials.token?.trim() ?? ''
      const organization = credentials.organization?.trim() ?? ''
      const project = credentials.project?.trim() ?? ''
      if (!token || !organization || !project) throw new ProviderOperationError('provider_bad_config', 400)
      const host = sentryHost(credentials.url?.trim() || DEFAULT_SENTRY_URL)
      if (!host) {
        throw new ProviderOperationError(
          'provider_bad_config',
          400,
          'acorn can reach https://sentry.io and https://de.sentry.io only.',
        )
      }
      try {
        const found = await checkProject({ token, host, organization, project })
        return { token, host, organization, project: found.slug || project, projectId: found.id }
      } catch (error) {
        if (isProviderOperationError(error)) throw error
        throw new ProviderOperationError('provider_unavailable', 502)
      }
    },
    normalize(_credentials, validated) {
      const config: SentryConnectionConfig = {
        organization: validated.organization,
        project: validated.project,
        host: validated.host,
        projectId: validated.projectId,
      }
      const name = `${validated.organization}/${validated.project}`
      return {
        secret: validated.token,
        label: `Sentry · ${name}`,
        account: { id: validated.projectId, label: name, type: 'project' },
        scopes: [],
        config,
        capabilities: { browse: 'available' },
      }
    },
    async test(secret, config) {
      const parsed = connectionConfig(config)
      if (!parsed) return { ok: false, error: 'provider_bad_config' }
      try {
        await checkProject({ token: secret, ...parsed })
        return { ok: true }
      } catch (error) {
        return { ok: false, error: isProviderOperationError(error) ? error.code : 'provider_unavailable' }
      }
    },
  },
  capabilities: { browse: true },
  budgets: { maxConcurrentRequests: 4, maxConcurrentRequestsPerConnection: 2 },
  projects: sentryProjectSource,
})
