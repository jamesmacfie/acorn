import { readJson, writeJson } from '@acorn/plugin-api/client'
import {
  agentSessionDefaultsRoute,
  type AgentSessionDefaults,
} from '../../shared/sessionDefaults'

export const agentSessionDefaultsQueryKey = ['agents', 'session-defaults'] as const

export const agentSessionDefaultsOptions = () => ({
  queryKey: agentSessionDefaultsQueryKey,
  queryFn: ({ signal }: { signal?: AbortSignal }) =>
    readJson<AgentSessionDefaults>(agentSessionDefaultsRoute, { signal }),
})

// Only the fields Settings owns. The node merges them onto the `last` values the runtime maintains.
export const saveAgentSessionDefaults = (patch: Partial<AgentSessionDefaults>) =>
  writeJson<AgentSessionDefaults>(
    agentSessionDefaultsRoute,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    },
    (response) => `agent session defaults ${response.status}`,
  )
