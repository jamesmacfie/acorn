import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/solid-query'
import type { AgentProviderDescriptor } from '../contract/wire.ts'

const providers = vi.fn(async (_force?: boolean): Promise<AgentProviderDescriptor[]> => [])
vi.mock('./sessions/managedClient', () => ({ managedAgentApi: { providers: (force?: boolean) => providers(force) } }))

const { AGENT_PROVIDERS_STALE_MS, agentProvidersOptions, agentProvidersQueryKey, refreshAgentProviders } =
  await import('./providersClient')

const claude = { id: 'claude', label: 'Claude' } as AgentProviderDescriptor

afterEach(() => providers.mockReset())

it('is one persisted key, fresh for a minute, read without forcing a probe', async () => {
  const options = agentProvidersOptions()
  // The persisted cache has no buster (docs/caching.md), so this key is part of the contract.
  expect(options.queryKey).toEqual(['agents', 'providers'])
  expect(options.staleTime).toBe(AGENT_PROVIDERS_STALE_MS)
  providers.mockResolvedValue([claude])
  const client = new QueryClient()
  expect(await client.fetchQuery(options)).toEqual([claude])
  // Within the stale time a second reader is answered from memory.
  expect(await client.fetchQuery(agentProvidersOptions())).toEqual([claude])
  expect(providers).toHaveBeenCalledTimes(1)
  expect(providers).toHaveBeenCalledWith(undefined)
})

it('refreshes by asking the node for a fresh probe and writing the answer into the cache', async () => {
  providers.mockResolvedValue([claude])
  const client = new QueryClient()
  expect(await refreshAgentProviders(client)).toEqual([claude])
  expect(providers).toHaveBeenCalledWith(true)
  expect(client.getQueryData(agentProvidersQueryKey)).toEqual([claude])
})
