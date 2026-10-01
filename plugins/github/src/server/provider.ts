import { defaultBudgets, externalIdsFor, ProviderOperationError, publicProvider } from '@acorn/plugin-api/node'
import { gh, ghError } from './githubApi'

type GithubViewer = { login: string; name: string | null; avatar_url: string | null }
type GithubValidated = { secret: string; viewer: GithubViewer; scopes: string[] }

// GitHub is an ordinary stored provider connection. Its encrypted token is read by githubToken.ts and
// can be rotated or disconnected like any other connection.
//
// `fields` is empty and `connectable` can still be true, which looks contradictory but is right: the
// owner supplies no credential by hand. The device-flow routes obtain the token from GitHub and hand
// it to the same connectProvider path every other provider uses, so validation, the encrypted write,
// the request scheduler and maxConnections all come for free. `connection.kind: 'device-flow'` on the
// public descriptor is what tells the settings UI to run that flow instead of rendering a form.
//
// `connectable` is false when this build has no OAuth client id. The device flow cannot start without
// one, so offering GitHub would lead to a dead end: first-run setup hides its GitHub card, and Add
// connection leaves GitHub out. A stored connection keeps working, because reading the token never
// consults this flag. The node passes the answer in at init; tests and the testkit use the
// connectable `githubProvider`.
export const createGithubProvider = (options: { connectable: boolean }) => publicProvider({
  id: 'github',
  label: 'GitHub',
  glyph: 'brand:github',
  kind: 'identity',
  connection: {
    authKind: 'oauth',
    kind: 'device-flow',
    fields: [],
    connectable: options.connectable,
    disconnectable: true,
    // One GitHub account at a time: the mirror tables are scoped by login, so a second account would
    // need a scope selector everywhere before it would mean anything.
    maxConnections: 1,
    async validate(credentials): Promise<GithubValidated> {
      const secret = typeof credentials.accessToken === 'string' ? credentials.accessToken.trim() : ''
      if (!secret) throw new ProviderOperationError('provider_bad_config', 400)
      const response = await gh(secret, '/user')
      if (ghError(response)) throw new ProviderOperationError('provider_needs_auth', 401)
      // GitHub reports the granted scopes on the response, not in the token: it is the only place we
      // can see what the owner actually approved.
      const scopes = (response.headers.get('x-oauth-scopes') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      return { secret, viewer: (await response.json()) as GithubViewer, scopes }
    },
    normalize(_credentials, validated: GithubValidated) {
      return {
        secret: validated.secret,
        label: validated.viewer.login,
        account: { id: validated.viewer.login, label: validated.viewer.login, type: 'user' },
        scopes: validated.scopes,
        config: {},
        capabilities: {},
      }
    },
    async test(secret) {
      const response = await gh(secret, '/user')
      return ghError(response) ? { ok: false, error: 'provider_needs_auth' } : { ok: true }
    },
  },
  externalIds: externalIdsFor('github'),
  capabilities: { repoAffinity: 'intrinsic' },
  resources: [],
  budgets: defaultBudgets,
  memory: { linkedItems: false, mutations: [], triggers: [], summarize: 'none', acceptedWrites: false },
})

export const githubProvider = createGithubProvider({ connectable: true })
