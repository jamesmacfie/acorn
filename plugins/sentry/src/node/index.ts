import type { NodePlugin } from '@acorn/plugin-api/node'
import { readEnvironment } from '../server/credentials'
import { sentryProvider } from '../server/provider'
import { createSentryFetch } from '../server/routes'

export const sentryPlugin = (): NodePlugin => ({
  name: 'sentry',
  init: (ctx) => {
    ctx.providers.connection(sentryProvider)
    // A worker's environment is fixed when it starts, so this is read once.
    const { target, warning } = readEnvironment(process.env)
    if (warning) ctx.log.warn(warning)
    ctx.routes.fetch(createSentryFetch(target, ctx.core.projects), {
      prefix: '',
      note: "/rail-items and /issues/:issue: a project's unresolved Sentry issues, read live",
    })
  },
})
