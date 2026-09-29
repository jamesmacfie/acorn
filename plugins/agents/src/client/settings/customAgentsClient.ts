import type { QueryClient } from '@tanstack/solid-query'
import { readJson, writeJson } from '@acorn/plugin-api/client'
import { customAgentsRoute, type CustomAgent, type CustomAgentInput } from '../../shared/customAgents'

export const customAgentsQueryKey = ['agents', 'custom-agents'] as const

/** One query for every reader: the Settings page, the pane's New picker, and the palette, so a save on
 *  the page moves all three at once. */
export const customAgentsOptions = () => ({
  queryKey: customAgentsQueryKey,
  queryFn: ({ signal }: { signal?: AbortSignal }) => readJson<CustomAgent[]>(customAgentsRoute, { signal }),
})

const send = (path: string, method: 'POST' | 'PUT' | 'DELETE', body?: CustomAgentInput) =>
  writeJson<CustomAgent>(
    path,
    {
      method,
      ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    },
    (response) => `custom agent ${response.status}`,
  )

/** Create one (`id` null) or replace one. The list is refetched either way, because the node owns the
 *  order and mints the id. */
export async function saveCustomAgent(queryClient: QueryClient, id: string | null, input: CustomAgentInput): Promise<CustomAgent> {
  try {
    return await send(id ? `${customAgentsRoute}/${encodeURIComponent(id)}` : customAgentsRoute, id ? 'PUT' : 'POST', input)
  } finally {
    void queryClient.invalidateQueries({ queryKey: customAgentsQueryKey })
  }
}

export async function deleteCustomAgent(queryClient: QueryClient, id: string): Promise<void> {
  try {
    await send(`${customAgentsRoute}/${encodeURIComponent(id)}`, 'DELETE')
  } finally {
    void queryClient.invalidateQueries({ queryKey: customAgentsQueryKey })
  }
}
