// The linear plugin's client part (docs/plugins.md § The plugin API).
//
// Linear owns no tables. Its provider descriptor and node routes use the core-owned external-item
// read model, while this client contribution supplies the rail source, reference panel, and pane.
import { type ClientPlugin, contentLinkRegistry } from '@acorn/plugin-api/client'
import { linearPaneContribution } from './paneContribution'
import { linearRefPanelContribution } from './refPanelContribution'
import { linearSourceContribution } from './sourceContribution'
import { linearContentLinkContribution } from './contentLink'

export const linearClientPlugin: ClientPlugin = {
  name: 'linear',
  init: (ctx) => {
    // The recogniser that turns a linear.app issue URL into an in-app target. Contributed from here
    // rather than from github, which is where it lived while github owned the registry.
    ctx.contribute(contentLinkRegistry, linearContentLinkContribution)
    ctx.sources.register(linearSourceContribution)
    ctx.panes.register(linearPaneContribution)
    // How plugins/github shows a ticket it found in a PR body without importing this plugin — the last
    // plugin→plugin edge on the boundary ledger (registries/refPanels.ts states the full argument).
    ctx.refPanels.register(linearRefPanelContribution)
  },
}
