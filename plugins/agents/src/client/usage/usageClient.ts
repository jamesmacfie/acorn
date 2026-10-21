import { readJson, writeJson } from '@acorn/plugin-api/client'
import type { AgentUsageSnapshot } from '../../shared/usage'
import { agentUsageProviderRefreshRoute, agentUsageRefreshRoute, agentUsageRoute } from '../../shared/usage'

export type AgentUsageClient = {
  read(): Promise<AgentUsageSnapshot>
  refresh(): Promise<AgentUsageSnapshot>
  refreshProvider(providerId: string): Promise<AgentUsageSnapshot>
}

export const agentUsageClient: AgentUsageClient = {
  read: () => readJson<AgentUsageSnapshot>(agentUsageRoute),
  // A refresh asks each provider's CLI and can take minutes, so it goes through the broker's long pool.
  refresh: () => writeJson<AgentUsageSnapshot>(agentUsageRefreshRoute, { method: 'POST', long: true }),
  refreshProvider: (providerId) =>
    writeJson<AgentUsageSnapshot>(agentUsageProviderRefreshRoute(providerId), { method: 'POST', long: true }),
}
