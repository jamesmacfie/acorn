import { publicConnectionProvider } from '@acorn/plugin-api/node'

export const ACCOUNT_PROVIDER = 'account'

// The sign-in is an ordinary connection: the access token is the encrypted secret, and the refresh token
// beside it lets the host renew it before it expires, so nothing here keeps a timer
// (docs/account-api.md § The sign-in plugin). The device flow's poll route hands the tokens to
// `connectProvider`, which calls `validate` and `normalize` below.
//
// This descriptor registers at every boot, so the steps that call the account service load on first use
// (./providerSteps.ts) and only what a descriptor must answer at once stays here.
const steps = () => import('./providerSteps')

export const accountProvider = () =>
  publicConnectionProvider<unknown>({
    id: ACCOUNT_PROVIDER,
    label: 'acorn account',
    glyph: 'user-round',
    kind: 'identity',
    connection: {
      authKind: 'oauth',
      kind: 'device-flow',
      fields: [],
      // Offered only when the build has an account service to sign in to. The address is checked when it's used.
      connectable: !!process.env.ACORN_ACCOUNT_URL?.trim(),
      disconnectable: true,
      // One person owns a Node, so one sign-in.
      maxConnections: 1,
      validate: async (credentials) => (await steps()).validate(credentials),
      normalize: (_credentials, validated) => (validated as { normalized: never }).normalized,
      test: async (secret) => (await steps()).test(secret),
      refresh: async (refreshToken) => (await steps()).refresh(refreshToken),
    },
    capabilities: {},
    budgets: { maxConcurrentRequests: 2, maxConcurrentRequestsPerConnection: 1 },
  })
