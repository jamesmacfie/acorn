import { createEffect, on } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { type Task } from '@acorn/plugin-api/client'
import { worktreesKey, worktreesOptions } from './worktreeClient'
import { watchWorktreeInventory } from './worktreeInvalidation'
import { createHistoryModel } from './historyModel'
import { createGitViewSignal } from './viewState'

export function createGitPaneModel(task: Task) {
  const queryClient = useQueryClient()
  const inventory = createQuery(() => worktreesOptions(task.projectId))
  const state = <T,>(name: string, initial: () => T) => createGitViewSignal(() => task.projectId, () => `pane:${name}`, initial, () => task.id)
  const [selected, setSelected] = state<string | null>('worktree', () => null)
  const [section, setSection] = state<'history' | 'stashes' | 'worktrees'>('section', () => 'history')
  const [stashId, setStashId] = state<string | null>('stash', () => null)
  const [commitId, setCommitId] = state<string | null>('commit', () => null)
  const branchRef = () => task.branch ? `refs/heads/${task.branch}` : null
  const [missingBranch, setMissingBranch] = createGitViewSignal(() => task.projectId,
    () => `pane:missing-branch:${branchRef()}`, () => false, () => task.id)
  const history = createHistoryModel(() => task.projectId, branchRef, () => task.id)
  const refreshHistory = () => {
    if (missingBranch()) { setMissingBranch(false); history.setRef(branchRef()) }
    history.refresh()
  }
  watchWorktreeInventory(() => {
    void queryClient.invalidateQueries({ queryKey: worktreesKey(task.projectId) })
    if (missingBranch()) refreshHistory()
  })
  createEffect(on(() => JSON.stringify(history.filter()), () => setCommitId(null), { defer: true }))
  createEffect(() => {
    if (task.branch && history.ref() && (history.first.error as { code?: string } | null)?.code === 'bad_ref' && !history.first.isFetching) {
      setMissingBranch(true)
      history.setRef(null)
    }
  })
  createEffect(() => {
    const id = selected()
    const rows = inventory.data?.worktrees
    if (id && rows && !rows.some((entry) => entry.id === id)) setSelected(null)
  })
  return { inventory, selected, setSelected, section, setSection, stashId, setStashId, commitId, setCommitId, history, missingBranch, refreshHistory }
}

export type GitPaneModel = ReturnType<typeof createGitPaneModel>
