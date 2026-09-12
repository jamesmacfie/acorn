import { readJson, writeJson } from '@acorn/plugin-api/client'
import {
  agentConcurrencyRoute,
  type AgentConcurrencyLimits,
} from '../../shared/concurrency'

export const agentConcurrencyQueryKey = ['agents', 'concurrency'] as const

export const agentConcurrencyOptions = () => ({
  queryKey: agentConcurrencyQueryKey,
  queryFn: ({ signal }: { signal?: AbortSignal }) =>
    readJson<AgentConcurrencyLimits>(agentConcurrencyRoute, { signal }),
})

export const saveAgentConcurrency = (limits: AgentConcurrencyLimits) =>
  writeJson<AgentConcurrencyLimits>(
    agentConcurrencyRoute,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(limits),
    },
    (response) => `agent concurrency ${response.status}`,
  )
