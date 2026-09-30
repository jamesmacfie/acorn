import type { QueryClient } from '@tanstack/solid-query'
import type { AgentProviderDescriptor } from '../contract/wire.ts'
import { managedAgentApi } from './sessions/managedClient'

// The harnesses this node can run, as the Agent pane's New menu and empty state show them.
//
// One cached query rather than a read per pane model, because the model is built again on every task
// visit and the node's answer is the same for every task. Persisted like every other key
// (docs/caching.md), so the key must change if the descriptor gains a required field.
export const agentProvidersQueryKey = ['agents', 'providers'] as const

// A minute: install and sign-in state changes rarely, the node serves its own last answer at once, and
// the Refresh button below asks for a fresh probe when the owner has just changed something.
export const AGENT_PROVIDERS_STALE_MS = 60_000

export const agentProvidersOptions = () => ({
  queryKey: agentProvidersQueryKey,
  queryFn: () => managedAgentApi.providers(),
  staleTime: AGENT_PROVIDERS_STALE_MS,
})

/** Probe every harness again on the node and put the answer in the cache. */
export async function refreshAgentProviders(queryClient: QueryClient): Promise<AgentProviderDescriptor[]> {
  const fresh = await managedAgentApi.providers(true)
  queryClient.setQueryData(agentProvidersQueryKey, fresh)
  return fresh
}
