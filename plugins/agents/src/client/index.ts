// The agents plugin's client part (docs/plugins.md § The plugin API).
//
// `required: true`, matching the node half: the Agent pane and the Agent Center rail source are what
// the managed-agent runtime is for, and core's task view falls back to a pane list that assumes they
// exist.
import { lazy } from 'solid-js'
import { brandMarkRegistry, type ClientPlugin } from '@acorn/plugin-api/client'
import { ATTENTION_COPY, isActiveAgent, needsAttention } from './agentActivity'
import { agentSessionsCollection } from './collectionContribution'
import { managedAgentApi } from './managedClient'
import { activateManagedAgentNoticeTargets, activateManagedAgentPaneIntents } from './managedSelection'
import { activateManagedAgentNotifications } from './managedStore'
import { agentPaneContribution } from './paneContribution'
import { activateManagedAgentReferences } from './referenceContribution'
import { agentCenterSourceContribution } from './sourceContribution'
import { agentToolFoldSlice } from './toolFoldPrefs'

const AgentConcurrencySettings = lazy(() => import('./AgentConcurrencySettings'))
const AgentPricingSettings = lazy(() => import('./AgentPricingSettings'))
const AgentSessionDefaultsSettings = lazy(() => import('./AgentSessionDefaultsSettings'))

export const agentsClientPlugin: ClientPlugin = {
  name: 'agents',
  required: true,
  init: (ctx) => {
    // The harnesses' own marks, so a provider reads as itself wherever it is named. The node's
    // descriptors point their `glyph` at these names (main/drivers/claudeHarness.ts, codexDriver.ts).
    //
    // Same artwork as `brand:model-providers/anthropic` and `brand:model-providers/openai`, copied
    // rather than borrowed: a mark belongs to the plugin that draws it, and naming another package's
    // would put the literal string `brand:model-providers/openai` on screen the moment that package is
    // disabled. See docs/ui-design.md section Icons. From simple-icons (CC0 artwork; each trademark
    // remains its owner's).
    ctx.contribute(brandMarkRegistry, { id: 'agents/claude', color: '#D97757', d: 'M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z' })
    ctx.contribute(brandMarkRegistry, { id: 'agents/codex', color: '#412991', d: 'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z' })
    ctx.panes.register(agentPaneContribution)
    ctx.sources.register(agentCenterSourceContribution)
    // The same roster the stat counts and the inbox filters, with a schema on it, so a dashboard panel
    // can be composed over running agents (collectionContribution.ts).
    ctx.collections.register(agentSessionsCollection)
    // How a transcript's tool cards start out (toolFoldPrefs.ts). This device's, so the slice is
    // declared here and the key is listed as device-owned in persistence/devicePrefs.ts.
    ctx.persistedState.register(agentToolFoldSlice)
    ctx.settingsPages.register({
      id: 'agent-concurrency', label: 'Agent concurrency', group: 'general', order: 44, requires: 'desktop',
      component: AgentConcurrencySettings,
    })
    ctx.settingsPages.register({
      id: 'agent-pricing', label: 'Agent pricing', group: 'general', order: 45, requires: 'desktop',
      component: AgentPricingSettings,
    })
    ctx.settingsPages.register({
      id: 'agent-defaults', label: 'Agent defaults', group: 'general', order: 43, requires: 'desktop',
      component: AgentSessionDefaultsSettings,
    })
    // Fleet home's "agents running" number. Addressed at an explicit node, never the ambient one,
    // because the card exists to show several nodes at once.
    ctx.nodeStats.register({
      id: 'agents.active', order: 10, label: ['agent running', 'agents running'],
      fetch: async (nodeId, signal) =>
        (await managedAgentApi.sessions({ archived: false }, { nodeId, signal })).sessions.filter(isActiveAgent).length,
    })
    // The attention inbox's most important source: an agent waiting on a permission or a question is
    // blocked until the owner answers. `attention: true` is a server-side filter the route already
    // supports, so this is one request per node rather than a full roster fetch and a client filter.
    ctx.attention.register({
      id: 'agents.sessions', order: 10,
      fetch: async (nodeId, signal) => {
        const page = await managedAgentApi.sessions({ attention: true, archived: false }, { nodeId, signal })
        return page.sessions.filter(needsAttention).map((session) => {
          const copy = ATTENTION_COPY[session.attention] ?? { title: 'needs attention', severity: 'warn' as const }
          return {
            // Not the bare session id: the row's identity is (this source, this session), and two
            // sources colliding on a session id would make one of them un-renderable.
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
  // Not registration: these three attach listeners to the managed-session store and return nothing the
  // registries can hold. `activateManagedAgentNotifications` also opens the app-lifetime agent
  // WebSocket subscription and primes the store over HTTP, which is why the whole set is in `activate`
  // rather than `init`.
  activate: () => {
    activateManagedAgentReferences()
    activateManagedAgentNotifications()
    activateManagedAgentNoticeTargets()
    activateManagedAgentPaneIntents()
  },
}
