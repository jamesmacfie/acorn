// The changes plugin's client part (docs/plugins.md § The plugin API).
import type { ClientPlugin } from '@acorn/plugin-api/client'
import { changesAgentToolRenderer } from './agentToolRenderer'
import { changesPaneContribution } from './paneContribution'

export const changesClientPlugin: ClientPlugin = {
  name: 'changes',
  init: (ctx) => {
    ctx.panes.register(changesPaneContribution)
    // Renders this plugin's own `local_*` and `git_log` tool calls in an agent transcript. It lives
    // here, not in agents, for the same reason the tools themselves moved out in W6: the plugin
    // that owns a tool owns how its result reads.
    ctx.agentToolRenderers.register(changesAgentToolRenderer)
  },
}
