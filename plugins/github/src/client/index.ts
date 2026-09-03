import { lazy } from 'solid-js'
import { type ClientPlugin, readJson, setSelectedSource } from '@acorn/plugin-api/client'
import type { PluginCollectionResponse } from '@acorn/protocol/collections.ts'
import { reposRoute } from '../shared/api'
import { PULL_INVOLVEMENT, PULLS_COLLECTION_ID, pullsCollectionRoute, pullsCollectionSchema } from '../shared/collections'
import { pullRefMatchesTask } from '../shared/pullRef'
import { DIFF_LINE_KEY, SUMMARY_BADGES_MAX } from './extensionPoints'
import { prFiltersSlice } from './pullList/filterStore'
import { prPaneContribution } from './pullDetail/paneContribution'
import { githubShortcutsSlotContribution } from './slotContribution'
import { githubContentLinkContributions } from './contentLinks'
import { githubIntegrationFlow } from './integrationFlow'
import { githubBrowsePath, githubRouteContributions } from './clientRoutes'
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
    // No `promotion`: github's browse creates a task inline from its PR list, seeding provider links
    // as it goes, rather than through PromoteToTaskModal. The client host enforces `providerId` and
    // gates the source on the GitHub integration.
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
    // The compiled feeder for collections (client-core/host/registries/sources/collections.ts). A loaded plugin
    // declares this in its manifest and the host synthesises the same contribution over its own
    // reader; github ships no manifest, so it supplies the fetch itself.
    //
    // No schema parse on the way in: this repo's own TypeScript answers this repo's own route
    // (docs/architecture-overview.md § wire validation). The parse exists for a loaded plugin's
    // answer, which is untrusted wire. Provenance is stamped rather than read, because a row never
    // names its own source.
    ctx.collections.register({
      collectionId: PULLS_COLLECTION_ID,
      name: 'My pull requests',
      schema: pullsCollectionSchema,
      params: [
        // `enum` with no declared values: the values are this user's repositories, and no static
        // declaration can name them. `paramOptions` below fills them on the device.
        { id: 'repo', name: 'Repository', type: 'enum' },
        // Unset means every open PR in every mirrored repo. Setting it hands the same columns from
        // a GitHub search, which is the only place two of the three answers exist
        // (shared/collections.ts § involvement). `multiple`, because "assigned to me or waiting on
        // my review" is one question.
        { id: 'involves', name: 'Involving me', type: 'enum', multiple: true, values: [...PULL_INVOLVEMENT] },
      ],
      // The repositories this user has mirrored, which is the set the mirror path can match. Reuses
      // the repo picker's route and cache, with no refresh of its own. A panel editor open long
      // enough for the list to go stale is not worth a poll.
      paramOptions: async (paramId, nodeId) => {
        if (paramId !== 'repo') return []
        const repos = await readJson<{ owner: string; name: string }[]>(reposRoute, { nodeId })
        return repos
          .map((repo) => ({ id: `${repo.owner}/${repo.name}`, label: `${repo.owner}/${repo.name}` }))
          .sort((a, b) => a.label.localeCompare(b.label))
      },
      refresh: 60,
      fetch: async (nodeId, params, signal) => {
        const query = new URLSearchParams(
          Object.entries({ repo: params.repo, involves: params.involves }).filter(([, value]) => !!value) as [string, string][],
        ).toString()
        const body = await readJson<PluginCollectionResponse>(`${pullsCollectionRoute}${query ? `?${query}` : ''}`, { nodeId, signal })
        return {
          schema: body.schema,
          rows: body.rows.map((row) => ({ ...row, pluginId: 'github', collectionId: PULLS_COLLECTION_ID })),
        }
      },
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
    ctx.slots.register(githubShortcutsSlotContribution)
    ctx.persistedStateSlices.register(prFiltersSlice)
  },
}
