import { createEffect, createSignal, on } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { activeNodeId, type Task } from '@acorn/plugin-api/client'
import { worktreesOptions } from './worktreeClient'

export function createGitPaneModel(task: Task) {
  const inventory = createQuery(() => worktreesOptions(task.projectId))
  const [selected, setSelected] = createSignal<string | null>(null)
  createEffect(on(activeNodeId, () => setSelected(null), { defer: true }))
  return { inventory, selected, setSelected }
}

export type GitPaneModel = ReturnType<typeof createGitPaneModel>
