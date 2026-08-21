import type { NodePlugin } from '@acorn/plugin-api/node'
import { linearProvider } from '../server/provider'
import { createLinearFetch } from '../server/routes/linear'

export const linearPlugin = (): NodePlugin => ({
  name: 'linear',
  // The routes own this provider's whole namespace, so the mount is /v2/p/linear with no prefix. The
  // segment comes from the declared provider id, never from a prefix string. It stays behind
  // `requireProviderAccess` in the projection: a task-scoped internal token may not spend the owner's
  // Linear credential.
  //
  // Always the portable fetch carrier (docs/plugins.md § Loaded plugins): linear ships loaded, and a
  // bundled Hono instance cannot cross the contract.
  init: (ctx) => {
    ctx.providers.integration(linearProvider, createLinearFetch(ctx.core.projects))
  },
})
