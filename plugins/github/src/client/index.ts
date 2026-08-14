import { lazy } from 'solid-js'
import { type ClientPlugin, contentLinkRegistry, setSelectedSource } from '@acorn/plugin-api/client'
import { prFiltersSlice } from './pullList/filterSlice'
import { prPaneContribution } from './pullDetail/PrPane'
import { pullFilePaletteSlotContribution } from './slotContribution'
import { githubContentLinkContributions } from './contentLinks'
import { githubIntegrationFlow } from './integrationFlow'
import { githubBrowsePath, githubRouteContributions } from './routes'
import GithubImporter from './GithubImporter'

const GithubBrowse = lazy(() => import('./GithubBrowse'))

export const githubClientPlugin: ClientPlugin = {
  name: 'github',
  required: false,
  init: (ctx) => {
    // github.com PR and repo URLs, resolved in-app instead of opening a browser.
    for (const contribution of githubContentLinkContributions) ctx.contribute(contentLinkRegistry, contribution)
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
    ctx.slots.register(pullFilePaletteSlotContribution)
    ctx.persistedState.register(prFiltersSlice)
  },
}
