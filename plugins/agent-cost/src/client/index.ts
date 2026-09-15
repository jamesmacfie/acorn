import type { ClientPlugin } from '@acorn/plugin-api/client'
import { AGENT_SESSION_HEADER_POINT } from '@acorn/protocol/extensionPoints.ts'
import SessionCostBadge from './SessionCostBadge'

export const agentCostClientPlugin: ClientPlugin = {
  name: 'agent-cost',
  init: (ctx) => {
    // The Agents plugin owns the ledger and sends only folded usage facts through this point. This
    // plugin owns the estimate and its presentation, so removing it removes the behavior without
    // teaching Agents how token counters become money or what a price should look like.
    ctx.extensions.register({
      id: 'agent-cost.session-header',
      point: AGENT_SESSION_HEADER_POINT,
      label: 'Session cost',
      order: 10,
      component: SessionCostBadge,
    })
  },
}
