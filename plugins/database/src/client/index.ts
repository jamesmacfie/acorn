// The database plugin's client part (docs/plugins.md § The plugin API).
import type { ClientPlugin } from '@acorn/client-core/registries/plugin.ts'
import { databaseAgentContextContribution } from './agentContextContribution'
import { databasePaneContribution } from './paneContribution'

export const databaseClientPlugin: ClientPlugin = {
  name: 'database',
  init: (ctx) => {
    ctx.panes.register(databasePaneContribution)
    ctx.agentContexts.register(databaseAgentContextContribution)
  },
}
