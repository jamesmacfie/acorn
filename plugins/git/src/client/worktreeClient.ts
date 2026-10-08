import { activeNodeId, nodeReady, readJson, writeJson } from '@acorn/plugin-api/client'
import { cleanupRoute, inventoryRoute, type CleanupResult, type WorktreeInventory } from '../shared/api'

export const worktreesKey = (projectId: string) => ['git-worktrees', activeNodeId(), projectId] as const

export const worktreesOptions = (projectId: string) => ({
  queryKey: worktreesKey(projectId),
  queryFn: async ({ signal }: { signal: AbortSignal }) => {
    const result = await readJson<WorktreeInventory>(inventoryRoute(projectId), { signal })
    // A failed refresh must leave the last useful roster in the query cache.
    if (result.error) throw new Error(result.error)
    return result
  },
  enabled: nodeReady() && !!projectId,
  staleTime: 10_000,
})

export const removeWorktree = (projectId: string, observation: string) =>
  writeJson<CleanupResult>(cleanupRoute(projectId, observation), { method: 'POST' })
