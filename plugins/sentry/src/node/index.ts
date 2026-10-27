import type { NodePlugin } from '@acorn/plugin-api/node'
import { readEnvironment } from '../server/credentials'
import { sentryProvider } from '../server/provider'
import { createSentryFetch } from '../server/routes'

export const sentryPlugin = (): NodePlugin => ({
  name: 'sentry',
  init: (ctx) => {
    // A worker's environment is fixed when it starts, so this is read once.
    const { target, warning } = readEnvironment(process.env)
    if (warning) ctx.log.warn(warning)
    // The provider's route answers every path under /v1/p/sentry, so the plugin's routes ride on it.
    ctx.providers.integration(sentryProvider, createSentryFetch(target, ctx.core.projects))
  },
})
