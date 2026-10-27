import { lazyRouter, type NodePlugin } from '@acorn/plugin-api/node'
import { accountProvider, configuredAccountUrl } from '../server/provider'

// Signs a person in to an account service and registers this Node there (docs/account-api.md). It is
// inert until someone signs in: the routes load on their first request, and nothing here opens a
// connection or starts a timer at boot.
export const accountPlugin = (): NodePlugin => ({
  name: 'account',
  label: 'Account',
  init: (ctx) => {
    ctx.providers.connection(accountProvider())
    ctx.routes.register(
      lazyRouter(async () => (await import('../server/routes')).accountRoutes()),
      { prefix: '', note: 'sign-in, remote access, and relay tickets' },
    )
    // Offered only where there is an account service to list from, as the sign-in is. Listing makes no
    // request until someone has signed in.
    if (configuredAccountUrl()) {
      const nodes = () => import('../server/nodes')
      ctx.providers.nodes({
        id: 'nodes',
        label: 'acorn account',
        list: async (_signal, caller) => (await nodes()).listNodes(ctx.providers, caller),
        pairingAssertion: async (providerNodeId, _signal, caller) =>
          (await nodes()).assertionFor(ctx.providers, caller, providerNodeId),
      })
    }
  },
})
