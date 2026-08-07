// The agents plugin's client part (docs/vNext/plugins.md § The plugin API).
//
// `required: true`, matching the node half: the Agent pane and the Agent Center rail source are what
// the managed-agent runtime is FOR, and core's task view falls back to a pane list that assumes they
// exist.
import { lazy } from 'solid-js'
import type { ClientPlugin } from '@acorn/client-core/registries/plugin.ts'
import { activateManagedAgentNoticeTargets } from './managedSelection'
import { activateManagedAgentNotifications } from './managedStore'
import { agentPaneContribution } from './paneContribution'
import { activateManagedAgentReferences } from './referenceContribution'
import { agentCenterSourceContribution } from './sourceContribution'

const AgentPricingSettings = lazy(() => import('./AgentPricingSettings'))

export const agentsClientPlugin: ClientPlugin = {
  name: 'agents',
  required: true,
  init: (ctx) => {
    ctx.panes.register(agentPaneContribution)
    ctx.sources.register(agentCenterSourceContribution)
    // The `workflows.triggers` poller used to be registered here. It is workflows' — its id said so —
    // and it now lives in that plugin's client part.
    ctx.settingsPages.register({
      id: 'agent-pricing', label: 'Agent pricing', group: 'general', order: 45, requires: 'desktop',
      component: AgentPricingSettings,
    })
  },
  // Not registration: these three attach listeners to the managed-session store (agent references in
  // note bodies, the notice feed, and which notice targets resolve to a session) and return nothing
  // the registries can hold. `activateManagedAgentNotifications` also opens the app-lifetime agent
  // WebSocket subscription and primes the store over HTTP, which is why the whole set is in `activate`
  // rather than `init`.
  activate: () => {
    activateManagedAgentReferences()
    activateManagedAgentNotifications()
    activateManagedAgentNoticeTargets()
  },
}
