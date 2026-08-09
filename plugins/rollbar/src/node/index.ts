import type { NodePlugin } from '@acorn/plugin-api/node'
import { rollbarProvider } from '../server/provider'
import { rollbar, rollbarFetch } from '../server/routes/rollbar'

export const rollbarPlugin = (): NodePlugin => ({
  name: 'rollbar',
  init: (ctx) => {
    // A loaded plugin deliberately has no live-router seam: its bundled Hono cannot cross the
    // process-boundary contract. Built-ins keep their concrete router so route inventory remains
    // precise; the dogfood bundle takes the portable carrier and exercises the third-party path.
    const route = typeof ctx.routes.register === 'function' ? rollbar : rollbarFetch
    ctx.providers.integration(rollbarProvider, route)
  },
})
