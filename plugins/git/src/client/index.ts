import type { ClientPlugin } from '@acorn/plugin-api/client'
import { gitSourceContribution } from './sourceContribution'
import { gitPaneContribution } from './paneContribution'

export const gitClientPlugin: ClientPlugin = {
  name: 'git',
  init(ctx) {
    ctx.sources.register(gitSourceContribution)
    ctx.panes.register(gitPaneContribution)
  },
}
