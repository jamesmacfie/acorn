import { lazy } from 'solid-js'
import type { ClientPlugin } from '@acorn/plugin-api/client'
import { AGENT_TOOL_CARD_POINT } from '@acorn/protocol/extensionPoints.ts'

// The card loads with the first app_show in a transcript, and lang-core and the renderer with it.
const AppToolCard = lazy(() => import('./AppToolCard'))

export const trellisClientPlugin: ClientPlugin = {
  name: 'trellis',
  init: (ctx) => {
    // An agent-built app, drawn inline where the agent showed it (docs/agent-built-apps.md § Cards).
    ctx.extensions.register({
      id: 'trellis.app-card',
      point: AGENT_TOOL_CARD_POINT,
      label: 'Apps',
      order: 10,
      matches: ['app_show'],
      component: AppToolCard,
    })
  },
}
