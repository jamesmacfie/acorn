// The context plugin's client part (docs/plugins.md § The plugin API).
import type { ClientPlugin } from '@acorn/client-core/registries/plugin.ts'
import { taskContextAgentContribution } from './agentContextContribution'
import { contextPaneContribution } from './paneContribution'
import { contextSelectionSlice } from './selectionSlice'

export const contextClientPlugin: ClientPlugin = {
  name: 'context',
  init: (ctx) => {
    ctx.panes.register(contextPaneContribution)
    ctx.agentContexts.register(taskContextAgentContribution)
    ctx.persistedState.register(contextSelectionSlice)
  },
}
