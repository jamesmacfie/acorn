// The changes plugin's client part (docs/plugins.md § The plugin API).
import { openPane, type ClientPlugin } from '@acorn/plugin-api/client'
import { ChangesToolCard } from './ToolCard'
import { changesPaneContribution } from './paneContribution'
import { DIFF_LINE_KEY } from './extensionPoints'
import { AGENT_TOOL_CARD_POINT } from '@acorn/protocol/extensionPoints.ts'

export const changesClientPlugin: ClientPlugin = {
  name: 'changes',
  init: (ctx) => {
    ctx.panes.register(changesPaneContribution)
    // A row that says what this pane is for, beside core's generic `Show pane: Changes`. Somebody
    // reaching for the palette types "diff" or "staged", not "pane"
    // (docs/command-palette-and-shortcuts.md). Staging, committing, pushing and
    // review notes stay in the pane, where the diff and the selected files are visible.
    ctx.commands.register({
      id: 'changes.open',
      title: 'Open the Changes pane',
      hint: 'the diff between this task and its base',
      keywords: ['diff', 'git', 'staged', 'commit'],
      category: 'navigation',
      palette: true,
      scope: 'task',
      requires: { plugin: 'changes' },
      run: (context) => {
        if (context.taskId) openPane(context.taskId, 'changes')
      },
    })
    // What another plugin may say about a line of this pane's diff: coverage, a lint result, a blame
    // note. Keyed by file, line and side, which is what the viewer already knows about a row
    // (docs/plugins.md § Cooperative extension points). The node-side `changes:before-commit` and
    // `changes:before-push` hooks are declared next door in ../node/index.ts.
    ctx.extensionPoints.register({
      id: 'diff-line', label: 'Changes diff line', kind: 'annotation', key: [...DIFF_LINE_KEY], max: 4,
    })
    // Renders this plugin's own file tool calls in an agent transcript. It lives here rather than in
    // agents: the plugin that owns a tool owns how its result reads.
    //
    // Keyed on the harness's tool kind rather than on "did this call touch a path", which is what the
    // private client registry this replaced matched on. A point's arbitration has to be decidable
    // without running a contributor's code, so a predicate is not on offer, and these four kinds are
    // what the drivers report for a call that names files (docs/plugins.md § Cooperative extension
    // points).
    ctx.extensions.register({
      id: 'changes.tool-card',
      point: AGENT_TOOL_CARD_POINT,
      label: 'File tool calls',
      order: 10,
      matches: ['read', 'edit', 'delete', 'move'],
      component: ChangesToolCard,
    })
  },
}
