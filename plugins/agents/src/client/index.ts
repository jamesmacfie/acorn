// The agents plugin's client part (docs/vNext/plugins.md § The plugin API).
//
// `required: true`, matching the node half: the Agent pane and the Agent Center rail source are what
// the managed-agent runtime is FOR, and core's task view falls back to a pane list that assumes they
// exist.
import { lazy } from 'solid-js'
import type { ClientPlugin } from '@acorn/client-core/registries/plugin.ts'
import { ATTENTION_COPY, isActiveAgent, needsAttention } from './agentActivity'
import { managedAgentApi } from './managedClient'
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
    // Fleet home's "agents running" number. Addressed at an explicit node, never the ambient one: the
    // card exists to show several nodes at once.
    ctx.nodeStats.register({
      id: 'agents.active', order: 10, label: ['agent running', 'agents running'],
      fetch: async (nodeId, signal) =>
        (await managedAgentApi.sessions({ archived: false }, { nodeId, signal })).sessions.filter(isActiveAgent).length,
    })
    // The attention inbox's first and most important source: an agent waiting on a permission or a
    // question is blocked until the owner answers. `attention: true` is a server-side filter the route
    // already supports, so this is one request per node rather than a full roster fetch and a client
    // filter.
    ctx.attention.register({
      id: 'agents.sessions', order: 10,
      fetch: async (nodeId, signal) => {
        const page = await managedAgentApi.sessions({ attention: true, archived: false }, { nodeId, signal })
        return page.sessions.filter(needsAttention).map((session) => {
          const copy = ATTENTION_COPY[session.attention] ?? { title: 'needs attention', severity: 'warn' as const }
          return {
            // Not the bare session id: the row's identity is (this source, this session), and two sources
            // colliding on a session id would make one of them un-renderable.
            id: `agents.sessions:${session.id}`,
            taskId: session.taskId,
            title: `${session.title || session.providerId} ${copy.title}`,
            detail: session.runtimeState,
            severity: copy.severity,
            // `updatedAt`, not now(): the row shows how long this has been waiting, which is the number
            // that decides whether the owner should care.
            at: session.updatedAt,
            target: { kind: 'managed-agent', resourceId: session.id },
          }
        })
      },
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
