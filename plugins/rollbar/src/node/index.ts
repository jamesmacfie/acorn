import type { NodePlugin } from '@acorn/plugin-api/node'
import { rollbarProvider } from '../server/provider'
import { createRollbarFetch } from '../server/routes/rollbar'

export const rollbarPlugin = (): NodePlugin => ({
  name: 'rollbar',
  init: (ctx) => {
    // Portable fetch carrier: docs/integrations.md § Connection lifecycle covers why a loaded
    // plugin uses this instead of a live Hono router.
    ctx.providers.integration(rollbarProvider, createRollbarFetch(ctx.core.projects))
  },
})
