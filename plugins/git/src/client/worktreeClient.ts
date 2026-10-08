import { activeNodeId, nodeReady, readJson, writeJson } from '@acorn/plugin-api/client'
import { cleanupRoute, inventoryRoute, type CleanupResult, type WorktreeInventory } from '../shared/api'

export const worktreesKey = (projectId: string) => ['git-worktrees', activeNodeId(), projectId] as const

export const worktreesOptions = (projectId: string) => ({
  queryKey: worktreesKey(projectId),
  queryFn: ({ signal }: { signal: AbortSignal }) => readJson<WorktreeInventory>(inventoryRoute(projectId), { signal }),
  enabled: nodeReady() && !!projectId,
  staleTime: 10_000,
})

export const removeWorktree = (projectId: string, observation: string) =>
  writeJson<CleanupResult>(cleanupRoute(projectId, observation), { method: 'POST' })
