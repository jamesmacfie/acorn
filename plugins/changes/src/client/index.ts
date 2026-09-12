// The changes plugin's client part (docs/plugins.md § The plugin API).
import { openPane, type ClientPlugin } from '@acorn/plugin-api/client'
import { ChangesToolCard } from './ToolCard'
import { changeViewSlice } from './changesPrefs'
import { changesPaneContribution } from './paneContribution'
import { DIFF_LINE_KEY, PUSH_ACTIONS_MAX } from './extensionPoints'
import { AGENT_TOOL_CARD_POINT } from '@acorn/protocol/extensionPoints.ts'

export const changesClientPlugin: ClientPlugin = {
  name: 'changes',
  init: (ctx) => {
    ctx.panes.register(changesPaneContribution)
    // How the list is drawn: one device preference, so it survives a relaunch and stays on this
    // machine (./changesPrefs.ts, docs/state-ownership.md § Scope rules).
    ctx.persistedStateSlices.register(changeViewSlice)
    // A row that says what this pane is for, beside core's generic `Show pane: Changes`. Somebody
    // reaching for the palette types "diff" or "staged", not "pane"
    // (docs/command-palette-and-shortcuts.md). Staging, committing and review notes stay in the pane,
    // where the diff and the selected files are visible. The three remote verbs do have palette rows,
    // registered per task from the pane's model and gated on the pane having focus (./commands.ts): a
    // fetch needs nothing selected and nothing typed.
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
    // What somebody else may do once this branch is on its remote, drawn under the branch bar
    // (./RemoteBar.tsx). The GitHub plugin's "Open pull request" is the first filler, and this plugin
    // does not learn what a pull request is to draw it: the point hands over the branch, the upstream
    // and the two ids, and the contributor writes every word.
    //
    // A `remote` point rather than a `rows` one, because the verb is "go to a route of mine with a
    // parameter from the props", which is code, and a kit tree is the cheapest code that runs in
    // another plugin's surface (docs/plugins.md § Cooperative extension points).
    ctx.extensionPoints.register({
      id: 'push-actions', label: 'After a push', kind: 'remote', mode: 'stack', max: PUSH_ACTIONS_MAX,
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
