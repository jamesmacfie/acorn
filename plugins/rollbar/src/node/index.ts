import type { NodePlugin } from '@acorn/plugin-api/node'
import { rollbarProvider } from '../server/provider'
import { rollbar } from '../server/routes/rollbar'

export const rollbarPlugin = (): NodePlugin => ({
  name: 'rollbar',
  init: (ctx) => ctx.providers.integration(rollbarProvider, rollbar),
})
