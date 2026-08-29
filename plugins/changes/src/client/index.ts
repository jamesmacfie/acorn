// The changes plugin's client part (docs/plugins.md § The plugin API).
import type { ClientPlugin } from '@acorn/plugin-api/client'
import { changesAgentToolRenderer } from './agentToolRenderer'
import { changesPaneContribution } from './paneContribution'
import { DIFF_LINE_KEY } from './extensionPoints'

export const changesClientPlugin: ClientPlugin = {
  name: 'changes',
  init: (ctx) => {
    ctx.panes.register(changesPaneContribution)
    // What another plugin may say about a line of this pane's diff: coverage, a lint result, a blame
    // note. Keyed by file, line and side, which is what the viewer already knows about a row
    // (docs/plugins.md § Cooperative extension points). The node-side `changes:before-commit` and
    // `changes:before-push` hooks are declared next door in ../node/index.ts.
    ctx.extensionPoints.register({
      id: 'diff-line', label: 'Changes diff line', kind: 'annotation', key: [...DIFF_LINE_KEY], max: 4,
    })
    // Renders this plugin's own `local_*` and `git_log` tool calls in an agent transcript. It lives
    // here rather than in agents: the plugin that owns a tool owns how its result reads.
    ctx.agentToolRenderers.register(changesAgentToolRenderer)
  },
}
