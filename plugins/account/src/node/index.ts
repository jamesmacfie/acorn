import { lazyRouter, type NodePlugin } from '@acorn/plugin-api/node'
import { accountProvider } from '../server/provider'

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
  },
})
