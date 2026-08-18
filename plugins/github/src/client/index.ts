import { lazy } from 'solid-js'
import { type ClientPlugin, contentLinkRegistry, readJson, setSelectedSource } from '@acorn/plugin-api/client'
import type { PluginCollectionResponse } from '@acorn/protocol/collections.ts'
import { reposRoute } from '../contract/api'
import { PULL_INVOLVEMENT, PULLS_COLLECTION_ID, pullsCollectionRoute, pullsCollectionSchema } from '../contract/collections'
import { pullRefMatchesTask } from '../contract/pullRef'
import { prFiltersSlice } from './pullList/filterSlice'
import { prPaneContribution } from './pullDetail/PrPane'
import { pullFilePaletteSlotContribution } from './slotContribution'
import { githubContentLinkContributions } from './contentLinks'
import { githubIntegrationFlow } from './integrationFlow'
import { githubBrowsePath, githubRouteContributions } from './routes'
import GithubImporter from './GithubImporter'

const GithubBrowse = lazy(() => import('./GithubBrowse'))
// Lazy for the same reason every other surface here is: a panel nobody has opened should not be in the
// first paint's bundle.
const PullRefPanel = lazy(() => import('./PullRefPanel'))

export const githubClientPlugin: ClientPlugin = {
  name: 'github',
  required: false,
  init: (ctx) => {
    // github.com PR and repo URLs, resolved in-app instead of opening a browser.
    for (const contribution of githubContentLinkContributions) ctx.contribute(contentLinkRegistry, contribution)
    // The glance-sized half of a pull request, for a reader who is in the middle of something else. The
    // `providerId` is what a recognised PR URL resolves through, and the host binds it to this plugin.
    ctx.refPanels.register({ id: 'github-pull', providerId: 'github', component: PullRefPanel })
    // The PR rail is provider-owned and only appears once GitHub is connected. Core home remains the
    // default landing source, so a disabled/disconnected provider never becomes the startup view.
    //
    // No `promotion` either: github's browse creates a task inline from its PR list (seeding provider links
    // as it goes) rather than through PromoteToTaskModal, so there is nothing for the registry to hold.
    // `providerId` is enforced by the client host and gates the source on the GitHub integration.
    ctx.sources.register({
      id: 'github', order: 10, glyph: 'brand:github', label: 'GitHub', providerId: 'github', component: GithubBrowse, defaultPane: 'pr',
      routes: githubRouteContributions,
      // A PR-backed task lives at its PR URL. Core used to encode this itself by asking the route registry
      // for whatever owned `kind: 'detail'` — which was only ever this plugin, by luck of being the only
      // one with routes. The claim belongs here, where the shape of a PR URL is already known.
      taskPath: (task) => (task.pullNumber != null && task.github ? `${githubBrowsePath(task.projectId)}/${task.pullNumber}` : undefined),
      // The same knowledge read backwards, for "is there already a task for this PR" (registries/sources.ts
      // § tracksRef). A github-pr task records its pull request as `pullNumber` on the task ROW — its
      // `links` hold the Linear tickets found in the PR body — so the host's link matching cannot see it
      // and would have offered to create a duplicate.
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
    // The COMPILED feeder for collections (client-core/registries/collections.ts). A loaded plugin
    // declares this in its manifest and the host synthesises the same contribution over its own reader;
    // github ships no manifest, so it supplies the fetch itself.
    //
    // No schema parse on the way in, and that is the boundary rather than an omission: this response is
    // this repo's own TypeScript answering this repo's own route, which is the house rule for a read
    // (docs/architecture-overview.md § wire validation). The parse exists for a LOADED plugin's answer,
    // which is untrusted wire. Provenance is still stamped rather than read, for the same reason it is
    // on that path — a row never names its own source, even when the source is us.
    ctx.collections.register({
      collectionId: PULLS_COLLECTION_ID,
      name: 'My pull requests',
      schema: pullsCollectionSchema,
      params: [
        // `enum` with no declared values, because the values are this user's repositories and no static
        // declaration can name them — `paramOptions` below fills them on the device.
        { id: 'repo', name: 'Repository', type: 'enum' },
        // Unset is "every open PR in every mirrored repo" — the collection's original answer, and still
        // the default. Setting it hands the same columns from a GitHub search instead, which is the only
        // place two of the three answers exist (contract/collections.ts § involvement). `multiple`,
        // because "assigned to me or waiting on my review" is one question a person asks.
        { id: 'involves', name: 'Involving me', type: 'enum', multiple: true, values: [...PULL_INVOLVEMENT] },
      ],
      // The repositories this user has mirrored, which is also exactly the set the mirror path can match.
      // The repo picker's own route and cache; no new endpoint, and no refresh of its own — a panel editor
      // open long enough for the list to go stale is not a case worth a poll.
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
    ctx.slots.register(pullFilePaletteSlotContribution)
    ctx.persistedState.register(prFiltersSlice)
  },
}
