import type { NodePlugin } from '@acorn/plugin-api/node'
import { linearProvider } from '../server/provider'
import { createLinearFetch, linear } from '../server/routes/linear'

export const linearPlugin = (): NodePlugin => ({
  name: 'linear',
  // The router owns this provider's whole namespace, so the mount is /v2/p/linear with no prefix — the
  // segment comes from the declared provider id, never from a prefix string. It stays behind
  // `requireProviderAccess` in the projection: a task-scoped internal token may not spend the owner's
  // Linear credential.
  //
  // A loaded plugin deliberately has no live-router seam: its bundled Hono cannot cross the
  // process-boundary contract. The probe keeps both tiers working from one file — built-ins hand over
  // the concrete router so route inventory stays precise, and the loaded bundle hands over the portable
  // carrier. Linear ships loaded now, so the first branch is only reached by the suites that drive these
  // routes directly; it is not dead code.
  init: (ctx) => {
    const route = typeof ctx.routes.register === 'function' ? linear : createLinearFetch(ctx.core.projects)
    ctx.providers.integration(linearProvider, route)
  },
})
