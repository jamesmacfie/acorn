import { integrationsRoute, type IntegrationsResponse } from '@acorn/protocol/api.ts'
import { connectionName } from '@acorn/protocol/integrations.ts'
import { readJson } from '../../../infra/node/apiClient'
import type { AttentionItem, AttentionSourceContribution } from '../../../host/registries/rail/attention'
import { connectionPageOf, connectionStatusText } from './connections'

// A connection whose provider refused its credential, in the notification bell and as the dot beside
// Services or AI models in the settings rail (../SettingsView.tsx § waiting). A state rather than a
// notice: the connection stays refused until someone replaces the key or signs in again, so a
// dismissed row coming back on the next fetch is right.
//
// Core's rather than each provider plugin's, because `needs-auth` is core's status on core's rows, and
// one source covers a provider a plugin adds later.

export const CONNECTION_ATTENTION_ID = 'core.connectionsNeedAuth'

export const connectionAttention: AttentionSourceContribution = {
  id: CONNECTION_ATTENTION_ID,
  // After the plugin rows: a refused key blocks one provider, a plugin that did not start blocks all of it.
  order: 7,
  fetch: async (nodeId, signal) => {
    const { providers, integrations } = await readJson<IntegrationsResponse>(integrationsRoute, { nodeId, signal })
    const byId = new Map(providers.map((provider) => [provider.id, provider]))
    return integrations
      .filter((connection) => connection.status === 'needs-auth')
      .map((connection): AttentionItem => {
        const provider = byId.get(connection.providerId)
        return {
          id: `${CONNECTION_ATTENTION_ID}:${connection.id}`,
          title: `${connectionName(connection)} needs you to sign in again`,
          // The same sentence its page leads with, so the bell and the page agree about what went wrong.
          detail: `${connectionStatusText(connection, provider)}${provider?.connection.kind === 'device-flow' ? ' Disconnect it, then connect it again.' : ''}`,
          severity: 'warn',
          // When the node last checked it, which is when it found out, so the row does not reset to "just
          // now" on every fetch.
          at: connection.lastValidatedAt ?? connection.updatedAt,
          target: { kind: 'settings', resourceId: connectionPageOf(provider) },
        }
      })
  },
}
