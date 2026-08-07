// The linear plugin's client part (docs/plugins.md § The plugin API).
//
// Linear owns no tables. Its provider descriptor and node routes use the core-owned external-item
// read model, while this client contribution supplies the rail source, reference panel, and pane.
import type { ClientPlugin } from '@acorn/client-core/registries/plugin.ts'
import { linearPaneContribution } from './paneContribution'
import { linearRefPanelContribution } from './refPanelContribution'
import { linearSourceContribution } from './sourceContribution'

export const linearClientPlugin: ClientPlugin = {
  name: 'linear',
  init: (ctx) => {
    ctx.sources.register(linearSourceContribution)
    ctx.panes.register(linearPaneContribution)
    // How plugins/github shows a ticket it found in a PR body without importing this plugin — the last
    // plugin→plugin edge on the boundary ledger (registries/refPanels.ts states the full argument).
    ctx.refPanels.register(linearRefPanelContribution)
  },
}
