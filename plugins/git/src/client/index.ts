import type { ClientPlugin } from '@acorn/plugin-api/client'
import { lazy } from 'solid-js'
import { AGENT_TOOL_CARD_POINT } from '@acorn/protocol/extensionPoints.ts'
import { gitSourceContribution } from './sourceContribution'
import { gitPaneContribution } from './paneContribution'
import { openChangesTab } from './gitPane'
import { changeViewSlice } from './changes/changesPrefs'
import { changesRailMarkerContribution } from './changes/railMarker'
import { DIFF_LINE_KEY, PUSH_ACTIONS_MAX } from './changes/extensionPoints'
const GitSettings = lazy(() => import('./GitSettings'))
const GitAppearance = lazy(() => import('./GitSettings').then((module) => ({ default: module.GitAppearanceSettings })))
const ChangesToolCard = lazy(() => import('./changes/ToolCard').then((module) => ({ default: module.ChangesToolCard })))

export const gitClientPlugin: ClientPlugin = {
  name: 'git',
  init(ctx) {
    ctx.sources.register(gitSourceContribution)
    ctx.panes.register(gitPaneContribution)
    ctx.settingsPages.register({
      id: 'git',
      label: 'Git',
      category: 'features',
      scope: 'node',
      icon: 'git-branch',
      order: 42,
      requires: { plugin: 'git' },
      keywords: ['author', 'email', 'pull', 'rebase', 'fetch', 'identity'],
      sections: [
        {
          id: 'identity',
          label: 'Git identity',
          rows: ['Repository', 'Write scope', 'Effective author', 'Effective email', 'Author name', 'Author email'],
        },
        { id: 'behavior', label: 'Git behavior', rows: ['Pull strategy', 'Auto-fetch'] },
      ],
      component: GitSettings,
    })
    ctx.settingsPages.register({
      id: 'git-display',
      label: 'Git display',
      category: 'features',
      scope: 'device',
      icon: 'git-branch',
      order: 43,
      requires: { plugin: 'git' },
      keywords: ['graph', 'diff', 'unified', 'split'],
      sections: [{ id: 'display', label: 'Git display', rows: ['History graph', 'Diff presentation'] }],
      component: GitAppearance,
    })
    registerChanges(ctx)
  },
}

/** The Changes tab's client half: what it draws on the rail, the preference it keeps, its palette row,
 *  the two points it hosts, and how its file tool calls read in an agent transcript. */
function registerChanges(ctx: Parameters<ClientPlugin['init']>[0]) {
  // A dot on each task row and on the pane's rail button for which way the uncommitted lines lean
  // (./changes/railMarker.ts).
  ctx.railMarkers.register(changesRailMarkerContribution)
  // How the list is drawn: one device preference, so it survives a relaunch and stays on this
  // machine (./changes/changesPrefs.ts, docs/state-ownership/scope-rules.md § Scope rules).
  ctx.persistedStateSlices.register(changeViewSlice)
  // A row that says what the tab is for, beside core's generic `Show pane: Git`. Somebody reaching for
  // the palette types "diff" or "staged", not "pane" (docs/command-palette-and-shortcuts.md). Staging,
  // committing and review notes stay in the tab, where the diff and the selected files are visible.
  // The three remote verbs do have palette rows, registered per task from the tab's model and gated
  // on the pane having focus (./changes/commands.ts): a fetch needs nothing selected and nothing typed.
  ctx.commands.register({
    id: 'changes.open',
    title: 'Open Changes',
    hint: 'what changed in this task',
    keywords: ['diff', 'git', 'staged', 'commit'],
    category: 'navigation',
    palette: true,
    scope: 'task',
    requires: { plugin: 'git' },
    run: (context) => {
      if (context.taskId) openChangesTab(context.taskId)
    },
  })
  // What another plugin may say about a line of the Changes diff: coverage, a lint result, a blame
  // note. Keyed by file, line and side, which is what the viewer already knows about a row
  // (docs/plugins/cooperative-extension-points.md § Cooperative extension points). The node-side
  // `git:before-commit` and `git:before-push` hooks are declared in ../server/changes/registerChanges.ts.
  ctx.extensionPoints.register({
    id: 'diff-line',
    label: 'Changes diff line',
    kind: 'annotation',
    key: [...DIFF_LINE_KEY],
    max: 4,
  })
  // What somebody else may do once this branch is on its remote, drawn under the branch bar
  // (./changes/RemoteBar.tsx). The GitHub plugin's "Open pull request" is the first filler, and this
  // plugin does not learn what a pull request is to draw it: the point hands over the branch, the
  // upstream and the two ids, and the contributor writes every word.
  //
  // A `remote` point rather than a `rows` one, because the verb is "go to a route of mine with a
  // parameter from the props", which is code, and a kit tree is the cheapest code that runs in
  // another plugin's surface (docs/plugins/cooperative-extension-points.md § Cooperative extension points).
  ctx.extensionPoints.register({
    id: 'push-actions',
    label: 'After a push',
    kind: 'remote',
    mode: 'stack',
    max: PUSH_ACTIONS_MAX,
  })
  // Renders the file tool calls in an agent transcript. It lives here rather than in agents: the plugin
  // that owns a tool owns how its result reads.
  //
  // Keyed on the harness's tool kind rather than on "did this call touch a path". A point's
  // arbitration has to be decidable without running a contributor's code, so a predicate is not on
  // offer, and these four kinds are what the drivers report for a call that names files
  // (docs/plugins/cooperative-extension-points.md § Cooperative extension points).
  ctx.extensions.register({
    id: 'changes.tool-card',
    point: AGENT_TOOL_CARD_POINT,
    label: 'File tool calls',
    order: 10,
    matches: ['read', 'edit', 'delete', 'move'],
    component: ChangesToolCard,
  })
}
