// The http plugin's client part (docs/vNext/plugins.md § The plugin API).
import { lazy } from 'solid-js'
import type { ClientPlugin } from '@acorn/client-core/registries/plugin.ts'
import { httpAgentContextContribution } from './agentContextContribution'
import { purgeStoredHttpDrafts } from './draft'
import { httpPaneContribution } from './paneContribution'
import { httpSourceContribution } from './sourceContribution'

const HttpVariablesSettings = lazy(() => import('./HttpVariablesSettings'))

export const httpClientPlugin: ClientPlugin = {
  name: 'http',
  init: (ctx) => {
    ctx.panes.register(httpPaneContribution)
    ctx.sources.register(httpSourceContribution)
    ctx.agentContexts.register(httpAgentContextContribution)
    // 'http' is the API PANEL's variables page. The 'api' id belonged to the deleted public-automation
    // token page; the two were deliberately distinct ids and the distinction survives the deletion.
    ctx.settingsPages.register({
      id: 'http', label: 'API requests', group: 'general', order: 66, component: HttpVariablesSettings,
    })
    // Activation: drops localStorage drafts whose task no longer exists. Once per boot, before the
    // panel can read one back (docs/http-client.md § drafts).
    purgeStoredHttpDrafts()
  },
}
