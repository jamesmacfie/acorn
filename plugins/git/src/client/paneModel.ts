import { createEffect, createSignal, on } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { activeNodeId, type Task } from '@acorn/plugin-api/client'
import { worktreesKey, worktreesOptions } from './worktreeClient'
import { watchWorktreeInventory } from './worktreeInvalidation'
import { createHistoryModel } from './historyModel'

export function createGitPaneModel(task: Task) {
  const queryClient = useQueryClient()
  const inventory = createQuery(() => worktreesOptions(task.projectId))
  const [selected, setSelected] = createSignal<string | null>(null)
  const [section, setSection] = createSignal<'history' | 'worktrees'>('history')
  const [commitId, setCommitId] = createSignal<string | null>(null)
  const [missingBranch, setMissingBranch] = createSignal(false)
  const branchRef = () => task.branch ? `refs/heads/${task.branch}` : null
  const history = createHistoryModel(() => task.projectId, branchRef, () => task.id)
  const refreshHistory = () => {
    if (missingBranch()) { setMissingBranch(false); history.setRef(branchRef()) }
    history.refresh()
  }
  watchWorktreeInventory(() => {
    void queryClient.invalidateQueries({ queryKey: worktreesKey(task.projectId) })
    if (missingBranch()) refreshHistory()
  })
  createEffect(on(activeNodeId, () => { setSelected(null); setCommitId(null) }, { defer: true }))
  createEffect(on(() => JSON.stringify([activeNodeId(), task.id, task.projectId, task.branch]), () => {
    setMissingBranch(false)
    history.setRef(branchRef())
  }, { defer: true }))
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
  return { inventory, selected, setSelected, section, setSection, commitId, setCommitId, history, missingBranch, refreshHistory }
}

export type GitPaneModel = ReturnType<typeof createGitPaneModel>
