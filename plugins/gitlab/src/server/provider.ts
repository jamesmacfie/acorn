import { defaultBudgets, externalIdsFor, ProviderOperationError, publicProvider } from '@acorn/plugin-api/node'
import { GITLAB_HOST, GITLAB_ORIGIN } from './config'
import { gitlabOrigin, originOf } from './servers'
import { gl, GITLAB_PROVIDER } from './gitlabApi'

type GitlabViewer = { username: string; name: string | null }
type GitlabValidated = {
  secret: string
  origin: string
  viewer: GitlabViewer
  refresh?: { refreshToken: string; expiresAt: number }
}

const TOKEN_URL = `${GITLAB_ORIGIN}/oauth/token`

/** An OAuth token answer as the host stores it. `created_at` is GitLab's clock, in seconds. */
export function oauthTokens(body: {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  created_at?: number
}): { secret: string; refreshToken: string; expiresAt: number } | null {
  if (!body.access_token || !body.refresh_token) return null
  const issuedAt = typeof body.created_at === 'number' ? body.created_at * 1000 : Date.now()
  return {
    secret: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: issuedAt + (body.expires_in ?? 7200) * 1000,
  }
}

const viewer = async (origin: string, secret: string): Promise<GitlabViewer | null> => {
  const response = await gl({ origin, token: secret }, '/user')
  return response.ok ? ((await response.json()) as GitlabViewer) : null
}

// How many servers, gitlab.com among them, one person can connect. Each connection is one account on
// one server.
const MAX_SERVERS = 8

// GitLab is a stored provider connection with two ways in. The device flow, under `/auth/device/*`,
// signs in to gitlab.com with acorn's OAuth application and hands back tokens that expire after two
// hours, so the connection carries a refresh token and the host renews it. A personal access token,
// typed into the `token` field, lasts until the person revokes it and is never renewed. With a
// `baseUrl`, the token signs in to a company server instead, and the connection's config keeps that
// address (./servers.ts).
//
// `connectable` is false when this build has no OAuth client id. The token field still works then,
// so the provider stays offered: Add connection shows the token form on its own.
export const createGitlabProvider = (options: { clientId: () => string }) =>
  publicProvider({
    id: GITLAB_PROVIDER,
    label: 'GitLab',
    glyph: 'brand:gitlab',
    kind: 'identity',
    connection: {
      authKind: 'oauth',
      kind: options.clientId() ? 'device-flow' : 'fields',
      fields: [
        {
          id: 'token',
          label: 'Personal access token',
          type: 'password',
          required: true,
          hint: 'A token with the api scope, if you would rather not sign in with a code.',
        },
        {
          id: 'baseUrl',
          label: 'GitLab address',
          type: 'url',
          placeholder: 'https://gitlab.com',
          required: false,
          hint: "Your company's GitLab server, such as https://gitlab.example.com. Leave it empty for gitlab.com.",
        },
        {
          id: 'allowPrivate',
          label: 'Connect to a private address',
          type: 'checkbox',
          required: false,
          hint: 'Only for a server on this computer or a private network, such as 10.0.0.5.',
        },
      ],
      connectable: true,
      disconnectable: true,
      maxConnections: MAX_SERVERS,
      async validate(credentials): Promise<GitlabValidated> {
        const typed = credentials.token?.trim()
        const secret = typed || credentials.accessToken?.trim()
        if (!secret) throw new ProviderOperationError('provider_bad_config', 400)
        const origin = gitlabOrigin(credentials.baseUrl, credentials.allowPrivate === 'true')
        const found = await viewer(origin, secret)
        if (!found) throw new ProviderOperationError('provider_needs_auth', 401)
        const expiresAt = Number(credentials.expiresAt)
        return {
          secret,
          origin,
          viewer: found,
          ...(!typed && credentials.refreshToken && Number.isFinite(expiresAt)
            ? { refresh: { refreshToken: credentials.refreshToken, expiresAt } }
            : {}),
        }
      },
      normalize(_credentials, validated: GitlabValidated) {
        const host = new URL(validated.origin).hostname
        // A company server's account is named with its host, so two servers' accounts read apart.
        const label = host === GITLAB_HOST ? validated.viewer.username : `${validated.viewer.username} on ${host}`
        return {
          secret: validated.secret,
          ...(validated.refresh ? { refresh: validated.refresh } : {}),
          label,
          account: { id: validated.viewer.username, label, type: 'user' },
          scopes: ['api'],
          config: { baseUrl: validated.origin },
          capabilities: {},
        }
      },
      async test(secret, config) {
        return (await viewer(originOf(config), secret)) ? { ok: true } : { ok: false, error: 'provider_needs_auth' }
      },
      async refresh(refreshToken) {
        const clientId = options.clientId()
        if (!clientId) throw new ProviderOperationError('provider_needs_auth', 401)
        const response = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId,
          }).toString(),
          signal: AbortSignal.timeout(10_000),
        })
        // GitLab answers a revoked or spent refresh token with 400 `invalid_grant`, or 401.
        if (response.status === 400 || response.status === 401)
          throw new ProviderOperationError('provider_needs_auth', 401)
        if (!response.ok) throw new ProviderOperationError('provider_unavailable', 502)
        const tokens = oauthTokens((await response.json()) as Parameters<typeof oauthTokens>[0])
        if (!tokens) throw new ProviderOperationError('provider_unavailable', 502)
        return tokens
      },
    },
    externalIds: externalIdsFor(GITLAB_PROVIDER),
    capabilities: { repoAffinity: 'intrinsic' },
    resources: [],
    // The mirror's batch sizes: `maxPages` pages of 100 projects or merge requests per list read.
    budgets: { ...defaultBudgets, maxPages: 5 },
    memory: { linkedItems: false, mutations: [], triggers: [], summarize: 'none', acceptedWrites: false },
  })
