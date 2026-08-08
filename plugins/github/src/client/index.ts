import { lazy } from 'solid-js'
import type { ClientPlugin } from '@acorn/client-core/registries/plugin.ts'
import { prFiltersSlice } from './pullList/filterSlice'
import { prPaneContribution } from './pullDetail/PrPane'
import { pullFilePaletteSlotContribution } from './slotContribution'
import { contentLinkRegistry } from '@acorn/client-core/registries/contentLinks.ts'
import { githubContentLinkContributions } from './contentLinks'
import { setSelectedSource } from '@acorn/client-core/tasks/tasks.ts'
import { githubRepositoryContribution } from './repositoryContribution'
import { githubIntegrationFlow } from './integrationFlow'
import { githubRouteContributions } from './routes'

const GithubBrowse = lazy(() => import('./GithubBrowse'))

export const githubClientPlugin: ClientPlugin = {
  name: 'github',
  required: true,
  init: (ctx) => {
    // github.com PR and repo URLs, resolved in-app instead of opening a browser.
    for (const contribution of githubContentLinkContributions) ctx.contribute(contentLinkRegistry, contribution)
    // No `providerId`: unlike linear's and rollbar's, this source is NOT gated on a connected integration
    // row. It has to be visible before GitHub is connected — that browse surface is where a fresh install
    // ends up, and gating it would leave first run with no source at all.
    //
    // No `promotion` either: github's browse creates a task inline from its PR list (seeding provider links
    // as it goes) rather than through PromoteToTaskModal, so there is nothing for the registry to hold.
    // `order: 10` is what puts GitHub at the head of the rail. Declared, so it survives this plugin being
    // moved anywhere in the client plugin list.
    ctx.sources.register({
      id: 'github', order: 10, glyph: '◇', label: 'GitHub', component: GithubBrowse, defaultPane: 'pr', isDefault: true,
      repository: githubRepositoryContribution,
      routes: githubRouteContributions,
    })
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
    ctx.slots.register(pullFilePaletteSlotContribution)
    ctx.persistedState.register(prFiltersSlice)
  },
}
