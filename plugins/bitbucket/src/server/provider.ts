import { defaultBudgets, externalIdsFor, ProviderOperationError, publicProvider } from '@acorn/plugin-api/node'
import type { BitbucketSession } from './bitbucketApi'
import { BITBUCKET_PROVIDER } from './config'

type BitbucketViewer = { nickname?: string | null; display_name?: string | null }
type BitbucketValidated = { secret: string; viewer: BitbucketViewer }

// What a token needs. Write on pull requests, because the plugin comments, approves, merges, and opens
// pull requests; the workspace, for the people a reviewer is chosen from.
const SCOPES = [
  'read:user:bitbucket',
  'read:workspace:bitbucket',
  'read:repository:bitbucket',
  'read:pullrequest:bitbucket',
  'write:pullrequest:bitbucket',
  'read:pipeline:bitbucket',
]

/** Who the credential signs in as, or why Bitbucket refused it, in Bitbucket's words when it gave
 *  some. */
async function viewer(
  session: BitbucketSession,
): Promise<{ ok: true; viewer: BitbucketViewer } | { ok: false; reason: string }> {
  // The API client loads on the first sign-in check, so a Node that never connects Bitbucket doesn't read it.
  const { bb, bitbucketMessage } = await import('./bitbucketApi')
  const response = await bb(session, '/user')
  if (response.ok) return { ok: true, viewer: (await response.json()) as BitbucketViewer }
  const message = await bitbucketMessage(response)
  return { ok: false, reason: message ? `Bitbucket said: ${message}` : `Bitbucket refused that email and API token.` }
}

// Bitbucket Cloud is a stored provider connection with one way in: an Atlassian API token and the
// email of the account it belongs to, sent as basic auth. OAuth isn't offered, because its token
// exchange needs a client secret, which a shipped binary can't keep.
export const bitbucketProvider = publicProvider({
  id: BITBUCKET_PROVIDER,
  label: 'Bitbucket',
  glyph: 'brand:bitbucket',
  kind: 'identity',
  connection: {
    authKind: 'api-key',
    fields: [
      {
        id: 'email',
        label: 'Atlassian email',
        type: 'text',
        placeholder: 'you@example.com',
        required: true,
        hint: 'The email you sign in to Bitbucket with.',
      },
      {
        id: 'token',
        label: 'API token',
        type: 'password',
        required: true,
        hint: `Create one at id.atlassian.com under Security, API tokens, as a token with scopes for Bitbucket: ${SCOPES.join(', ')}.`,
      },
    ],
    connectable: true,
    disconnectable: true,
    maxConnections: 1,
    async validate(credentials): Promise<BitbucketValidated> {
      const email = credentials.email?.trim()
      const token = credentials.token?.trim()
      if (!email || !token) throw new ProviderOperationError('provider_bad_config', 400)
      const secret = `${email}:${token}`
      const found = await viewer({ auth: secret })
      if (!found.ok) throw new ProviderOperationError('provider_needs_auth', 401, found.reason)
      return { secret, viewer: found.viewer }
    },
    normalize(_credentials, validated: BitbucketValidated) {
      const label = validated.viewer.nickname || validated.viewer.display_name || 'Bitbucket'
      return {
        secret: validated.secret,
        label,
        account: { id: label, label, type: 'user' },
        scopes: SCOPES,
        config: {},
        capabilities: {},
      }
    },
    async test(secret) {
      return (await viewer({ auth: secret })).ok ? { ok: true } : { ok: false, error: 'provider_needs_auth' }
    },
  },
  externalIds: externalIdsFor(BITBUCKET_PROVIDER),
  capabilities: { repoAffinity: 'intrinsic' },
  resources: [],
  // The mirror's batch sizes: `maxPages` pages per list read, 100 repositories or 50 pull requests a
  // page, Bitbucket's own page caps.
  budgets: { ...defaultBudgets, maxPages: 5 },
  memory: { linkedItems: false, mutations: [], triggers: [], summarize: 'none', acceptedWrites: false },
})
