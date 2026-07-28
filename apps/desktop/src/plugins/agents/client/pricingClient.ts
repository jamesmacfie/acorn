import { readJson, writeJson } from '../../../core/client/apiClient'
import {
  agentPricingRoute,
  type AgentPricingPreferences,
} from '../shared/pricing'

export const agentPricingQueryKey = ['agents', 'pricing'] as const

export const agentPricingOptions = () => ({
  queryKey: agentPricingQueryKey,
  queryFn: ({ signal }: { signal?: AbortSignal }) =>
    readJson<AgentPricingPreferences>(agentPricingRoute, { signal }),
})

export const saveAgentPricing = (preferences: AgentPricingPreferences) =>
  writeJson<AgentPricingPreferences>(
    agentPricingRoute,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(preferences),
    },
    (response) => `agent pricing ${response.status}`,
  )
