// The rollbar plugin's client part (docs/plugins.md § The plugin API).
//
// Like linear: no tables of its own (core owns `issues` / `issue_resources`), so everything that makes
// rollbar visible is here — a rail source and a pane.
import type { ClientPlugin } from '@acorn/client-core/registries/plugin.ts'
import { rollbarPaneContribution } from './paneContribution'
import { rollbarSourceContribution } from './sourceContribution'

export const rollbarClientPlugin: ClientPlugin = {
  name: 'rollbar',
  init: (ctx) => {
    ctx.sources.register(rollbarSourceContribution)
    ctx.panes.register(rollbarPaneContribution)
  },
}
