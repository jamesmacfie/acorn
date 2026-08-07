import type { NodePlugin } from '@acorn/node-core/server/plugin/types.ts'
import { linearProvider } from '../server/provider'
import { linear } from '../server/routes/linear'

export const linearPlugin = (): NodePlugin => ({
  name: 'linear',
  // The router owns this provider's whole namespace, so the mount is /v2/p/linear with no prefix — the
  // segment comes from the declared provider id, never from a prefix string. It stays behind
  // `requireProviderAccess` in the projection: a task-scoped internal token may not spend the owner's
  // Linear credential.
  init: (ctx) => ctx.providers.integration(linearProvider, linear),
})
