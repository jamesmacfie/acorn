import { readJson, writeJson } from '@acorn/client-core/apiClient.ts'
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
