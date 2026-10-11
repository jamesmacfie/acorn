import type { QueryClient } from '@tanstack/solid-query'
import { latestSignal, readJson, writeJson } from '@acorn/plugin-api/client'
import { agentSessionDefaultsRoute, type AgentSessionDefaults } from '../../shared/sessionDefaults'

export const agentSessionDefaultsQueryKey = ['agents', 'session-defaults'] as const

export const agentSessionDefaultsOptions = () => ({
  queryKey: agentSessionDefaultsQueryKey,
  queryFn: ({ signal }: { signal?: AbortSignal }) =>
    readJson<AgentSessionDefaults>(agentSessionDefaultsRoute, { signal }),
})

// Only the fields Settings owns. The node merges them onto the `last` values the runtime maintains.
const saveAgentSessionDefaults = (patch: Partial<AgentSessionDefaults>) =>
  writeJson<AgentSessionDefaults>(
    agentSessionDefaultsRoute,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    },
    (response) => `agent session defaults ${response.status}`,
  )

/**
 * The write with its cache handling, so a page and a command change this record the same way.
 *
 * The query cache carries each change so every reader moves at once. A write that fails puts back what
 * the cache held before it, but only when it is the latest write, so the first of two quick changes
 * cannot undo the second, and then refetches. The rollback matters because a refetch alone leaves the
 * unsaved value on screen when the node is what failed. The failure is rethrown, because the page and
 * the palette report it differently.
 */
const latestWrite = latestSignal()
export async function writeAgentSessionDefaults(
  queryClient: QueryClient,
  current: AgentSessionDefaults,
  patch: Partial<AgentSessionDefaults>,
): Promise<AgentSessionDefaults> {
  const write = latestWrite.next()
  queryClient.setQueryData(agentSessionDefaultsQueryKey, { ...current, ...patch })
  try {
    const saved = await saveAgentSessionDefaults(patch)
    queryClient.setQueryData(agentSessionDefaultsQueryKey, saved)
    return saved
  } catch (cause) {
    if (!write.aborted) queryClient.setQueryData(agentSessionDefaultsQueryKey, current)
    void queryClient.invalidateQueries({ queryKey: agentSessionDefaultsQueryKey })
    throw cause
  }
}
