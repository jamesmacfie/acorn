import { readJson, writeJson } from '../../../core/client/apiClient'
import type { AgentUsageSnapshot } from '../shared/usage'
import { agentUsageRefreshRoute, agentUsageRoute } from '../shared/usage'

export type AgentUsageClient = {
  read(): Promise<AgentUsageSnapshot>
  refresh(): Promise<AgentUsageSnapshot>
}

export const agentUsageClient: AgentUsageClient = {
  read: () => readJson<AgentUsageSnapshot>(agentUsageRoute),
  refresh: () => writeJson<AgentUsageSnapshot>(agentUsageRefreshRoute, { method: 'POST' }),
}
