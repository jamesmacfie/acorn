import { QueryClient } from '@tanstack/solid-query'
import { expect, it, vi } from 'vitest'
import type { WorktreeInventory } from '../shared/api'

const readJson = vi.fn()
vi.mock('@acorn/plugin-api/client', () => ({
  activeNodeId: () => 'node-a',
  nodeReady: () => true,
  readJson,
}))

const { worktreesKey, worktreesOptions } = await import('./worktreeClient')

it('keeps useful cached rows when an inventory refresh returns an error', async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const previous = {
    projectId: 'project',
    repository: '/repo',
    worktrees: [{ id: 'stable' }],
    error: null,
    observedAt: 1,
  } as WorktreeInventory
  queryClient.setQueryData(worktreesKey('project'), previous)
  readJson.mockResolvedValueOnce({ ...previous, worktrees: [], error: 'Git unavailable' })
  await expect(queryClient.fetchQuery({ ...worktreesOptions('project'), staleTime: 0 })).rejects.toThrow(
    'Git unavailable',
  )
  expect(queryClient.getQueryData(worktreesKey('project'))).toBe(previous)
  queryClient.clear()
})
