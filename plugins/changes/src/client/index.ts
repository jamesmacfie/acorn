// The changes plugin's client part (docs/plugins.md § The plugin API).
import type { ClientPlugin } from '@acorn/client-core/registries/plugin.ts'
import { changesAgentToolRenderer } from './agentToolRenderer'
import { changesPaneContribution } from './paneContribution'

export const changesClientPlugin: ClientPlugin = {
  name: 'changes',
  init: (ctx) => {
    ctx.panes.register(changesPaneContribution)
    // Renders this plugin's own `local_*` / `git_log` tool calls in an agent transcript. It belongs
    // here rather than in agents for the same reason the tools themselves moved in W6: the plugin that
    // owns the tool owns how its result reads.
    ctx.agentToolRenderers.register(changesAgentToolRenderer)
  },
}
