// The context plugin's client part (docs/plugins.md § The plugin API).
import type { ClientPlugin } from '@acorn/plugin-api/client'
import { taskContextAgentContribution } from './agentContextContribution'
import { contextPaneContribution } from './paneContribution'
import { contextSelectionSlice } from './selectionStore'

export const contextClientPlugin: ClientPlugin = {
  name: 'context',
  init: (ctx) => {
    ctx.panes.register(contextPaneContribution)
    // The one place another plugin may draw inside this pane: under a section the node assembled,
    // keyed by that section's id (./sectionPoint.ts). `stack`, so a contributor joins this pane's own
    // rows rather than standing in for them, and `max` is 2 because a section is a summary and a
    // third guest in it would be a pane of somebody else's.
    ctx.extensionPoints.register({
      id: 'section', label: 'Context section', kind: 'remote', mode: 'stack', max: 2,
    })
    ctx.agentContexts.register(taskContextAgentContribution)
    ctx.persistedStateSlices.register(contextSelectionSlice)
  },
}
