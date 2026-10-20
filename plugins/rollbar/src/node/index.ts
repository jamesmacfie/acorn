import { lazyFetch, type NodePlugin } from '@acorn/plugin-api/node'
import { rollbarProvider } from '../server/provider'
import { createRollbarFetch } from '../server/routes/rollbar'
import { errorSource } from '../shared/errorSource'
import { occurrenceCountSource } from '../shared/occurrenceCountSource'
import { createErrorSourceHandler } from '../server/data/errorSourceHandler'
import { setRollbarApiTelemetry } from '../server/index'

export const rollbarPlugin = (): NodePlugin => ({
  name: 'rollbar',
  init: (ctx) => {
    setRollbarApiTelemetry(ctx.telemetry)
    ctx.routes.fetch(createErrorSourceHandler(), { prefix: '/data/errors' })
    ctx.dataSources.register(errorSource)
    ctx.routes.fetch(
      lazyFetch(async () =>
        (await import('../server/data/occurrenceCountSource')).createOccurrenceCountSourceHandler(),
      ),
      { prefix: '/data/occurrence-counts' },
    )
    ctx.dataSources.register(occurrenceCountSource)
    // Portable fetch carrier: docs/integrations.md § Connection lifecycle covers why a loaded
    // plugin uses this instead of a live Hono router.
    ctx.providers.integration(rollbarProvider, createRollbarFetch(ctx.core.projects))
  },
})
