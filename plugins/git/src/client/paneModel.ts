import { createEffect, createSignal, on } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { activeNodeId, type Task } from '@acorn/plugin-api/client'
import { worktreesKey, worktreesOptions } from './worktreeClient'
import { watchWorktreeInventory } from './worktreeInvalidation'

export function createGitPaneModel(task: Task) {
  const queryClient = useQueryClient()
  const inventory = createQuery(() => worktreesOptions(task.projectId))
  const [selected, setSelected] = createSignal<string | null>(null)
  watchWorktreeInventory(() => void queryClient.invalidateQueries({ queryKey: worktreesKey(task.projectId) }))
  createEffect(on(activeNodeId, () => setSelected(null), { defer: true }))
  createEffect(() => {
    const id = selected()
    const rows = inventory.data?.worktrees
    if (id && rows && !rows.some((entry) => entry.id === id)) setSelected(null)
  })
  return { inventory, selected, setSelected }
}

export type GitPaneModel = ReturnType<typeof createGitPaneModel>
