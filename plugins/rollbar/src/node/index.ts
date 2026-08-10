import type { NodePlugin } from '@acorn/plugin-api/node'
import { rollbarProvider } from '../server/provider'
import { createRollbarFetch } from '../server/routes/rollbar'

export const rollbarPlugin = (): NodePlugin => ({
  name: 'rollbar',
  init: (ctx) => {
    // Always the portable fetch carrier: rollbar ships loaded, a bundled Hono instance cannot cross
    // the contract, and the compiled-tier branch that used to sit here went with the compiled mount.
    ctx.providers.integration(rollbarProvider, createRollbarFetch(ctx.core.projects))
  },
})
