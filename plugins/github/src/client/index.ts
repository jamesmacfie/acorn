import { lazy } from 'solid-js'
import { type ClientPlugin, setSelectedSource } from '@acorn/plugin-api/client'
import { pullRefMatchesTask } from '../shared/pullRef'
import { DIFF_LINE_KEY, SUMMARY_BADGES_MAX } from './extensionPoints'
import { prFiltersSlice } from './pullList/filterStore'
import { prPaneContribution } from './pullDetail/paneContribution'
import { githubShortcutsSlotContribution } from './slotContribution'
import { githubContentLinkContributions } from './contentLinks'
import { githubIntegrationFlow } from './integrationFlow'
import { githubBrowsePath, githubRouteContributions } from './clientRoutes'
import { CHANGES_PUSH_ACTIONS_POINT, GithubPushActions } from './pushActions'
import { githubPullPromotion } from './pullTasks'
import GithubImporter from './GithubImporter'

// Two lazy chunks off one module, because the source declares its list and its detail separately and
// a terminal shell draws them in two different panels (./GithubBrowse.tsx). Both resolve the same
// import, so the second is already in memory by the time it is asked for.
const GithubBrowseList = lazy(() => import('./GithubBrowse').then((module) => ({ default: module.GithubBrowseList })))
const GithubBrowseDetail = lazy(() => import('./GithubBrowse').then((module) => ({ default: module.GithubBrowseDetail })))
// Lazy: a panel nobody has opened should not be in the first paint's bundle.
const PullRefPanel = lazy(() => import('./PullRefPanel'))

export const githubClientPlugin: ClientPlugin = {
  name: 'github',
  required: false,
  init: (ctx) => {
    // github.com PR and repo URLs, resolved in-app instead of opening a browser.
    for (const contribution of githubContentLinkContributions) ctx.contentLinks.register(contribution)
    // The glance-sized half of a pull request, for a reader in the middle of something else. A
    // recognised PR URL resolves through `providerId`, which the host binds to this plugin.
    ctx.refPanels.register({ id: 'github-pull', providerId: 'github', component: PullRefPanel })
    // The PR rail is provider-owned and appears only once GitHub is connected. Core home stays the
    // default landing source, so a disconnected provider never becomes the startup view.
    //
    // Its list still creates a task inline, seeding provider links as it goes; the `promotion` below
    // is the thinner path the shared modal needs (./pullTasks.ts). The client host enforces
    // `providerId` and gates the source on the GitHub integration.
    ctx.sources.register({
      id: 'github', order: 10, glyph: 'brand:github', label: 'GitHub', providerId: 'github', defaultPane: 'pr',
      regions: { list: GithubBrowseList, detail: GithubBrowseDetail },
      // The rail is `github`; the tasks it makes carry `github-pr` (client/pullTasks.ts). Core used to
      // keep the glyph for that origin in a built-in table, which meant a task drawn by name here and
      // by hand there (client-core/features/tasks/origin.ts).
      origins: { 'github-pr': 'git-pull-request' },
      // GithubBrowse lists the routed project's pull requests, so the shell offers a project picker here.
      projectScoped: true,
      routes: githubRouteContributions,
      // A PR-backed task lives at its PR URL. The claim belongs here, where the shape of a PR URL is
      // known, rather than in core's route registry.
      taskPath: (task) => (task.pullNumber != null && task.github ? `${githubBrowsePath(task.projectId)}/${task.pullNumber}` : undefined),
      // The same knowledge read backwards, for "is there already a task for this PR"
      // (docs/plugins.md § Client authoring and the UI kit, `tracksRef`). A github-pr task records its
      // pull request as `pullNumber` on the task row; `links` holds the Linear tickets from the body.
      tracksRef: (task, ref) => ref.providerId === 'github' && task.pullNumber != null && !!task.github
        && pullRefMatchesTask(ref.displayId, task.github, task.pullNumber),
      // How a pull becomes a task for anyone but this plugin's own list (./pullTasks.ts).
      promotion: githubPullPromotion,
    })
    ctx.projectImporters.register({ id: 'github', label: 'Import from GitHub', glyph: 'brand:github', component: GithubImporter })
    ctx.commands.register({
      id: 'source.github.open',
      title: 'Go to GitHub in the left rail',
      category: 'navigation',
      palette: true,
      run: () => setSelectedSource('github'),
    })
    ctx.keybindings.register({
      id: 'source.github.open',
      command: 'source.github.open',
      description: 'Go to GitHub in the left rail',
      category: 'Tasks',
      defaultChord: 'meta+0',
      when: 'global',
    })
    ctx.integrationFlows.register(githubIntegrationFlow)
    ctx.panes.register(prPaneContribution)
    // The two places another plugin may come into a pull request (docs/plugins.md § Cooperative
    // extension points). Marks on a line of the diff, keyed the way the shared viewer keys a row;
    // and room beside the state and checks on the overview, where the owner's own facts stay and a
    // contributor is added to them.
    ctx.extensionPoints.register({
      id: 'diff-line', label: 'Pull request diff line', kind: 'annotation', key: [...DIFF_LINE_KEY], max: 4,
    })
    ctx.extensionPoints.register({
      id: 'summary-badges', label: 'Pull request summary', kind: 'remote', mode: 'stack', max: SUMMARY_BADGES_MAX,
    })
    // The one place this plugin comes into somebody else's surface: "Open pull request" under the
    // Changes pane's branch bar, offered on a task whose branch has an upstream and no pull request
    // yet (./pushActions.tsx). The changes plugin opened the point; this is the line that fills it.
    //
    // No `matches`, which in a `stack` point means every key: there is one box here and everybody who
    // has something to offer a pushed branch is in it.
    ctx.extensions.register({
      id: 'github.push-actions',
      point: CHANGES_PUSH_ACTIONS_POINT,
      label: 'Open pull request',
      order: 10,
      component: GithubPushActions,
    })
    ctx.slots.register(githubShortcutsSlotContribution)
    ctx.persistedStateSlices.register(prFiltersSlice)
  },
}
