// The http plugin's client part (docs/plugins.md § The plugin API).
import { lazy } from 'solid-js'
import type { ClientPlugin } from '@acorn/plugin-api/client'
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
  },
  // Drops localStorage drafts whose task no longer exists. Once per activation, before the panel can
  // read one back (docs/http-client.md § drafts). In `activate` rather than `init` because it is a
  // synchronous enumeration of `localStorage` — I/O, and the reason `init` is documented as
  // registration-only.
  activate: () => purgeStoredHttpDrafts(),
}
