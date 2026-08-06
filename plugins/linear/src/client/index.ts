// The linear plugin's client part (docs/vNext/plugins.md § The plugin API).
//
// Worth knowing: linear owns no tables. `issues` / `issue_resources` are core's generic external-item
// read model, shared with rollbar and reached through a core-owned store (phase2-notes.md § `issues`
// stays a core table), so the node half of this plugin is a provider descriptor and a router — nothing
// this file needs to know about. What makes linear VISIBLE is entirely here: a rail source and a pane.
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
