import { createEffect, createSignal, on, onCleanup } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { activeNodeId, clientEvents, consumePaneIntent, type PaneIntent, type Task } from '@acorn/plugin-api/client'
import { worktreesKey, worktreesOptions } from './worktreeClient'
import { operationKey } from './operationClient'
import { watchWorktreeInventory } from './worktreeInvalidation'
import { createHistoryModel } from './historyModel'
import { createGitViewSignal } from './viewState'
import { GIT_PANE, isGitSection, type GitSection } from './gitPane'

export function createGitPaneModel(task: Task) {
  const queryClient = useQueryClient()
  const inventory = createQuery(() => worktreesOptions(task.projectId))
  const state = <T,>(name: string, initial: () => T) => createGitViewSignal(() => task.projectId, () => `pane:${name}`, initial, () => task.id)
  const [selected, setSelected] = state<string | null>('worktree', () => null)
  const [section, setSection] = state<GitSection>('section', () => 'changes')
  // "Open in Changes" from elsewhere (./gitPane.ts § openChangesTab), held by the host until this
  // pane mounts.
  const applyIntent = (intent: PaneIntent | undefined) => {
    if (intent?.kind === 'plugin:select' && isGitSection(intent.item)) setSection(intent.item)
  }
  applyIntent(consumePaneIntent(task.id, GIT_PANE))
  onCleanup(clientEvents.on('presentation:pane-intent', (event) => {
    if (event.taskId !== task.id || event.paneId !== GIT_PANE) return
    consumePaneIntent(event.taskId, event.paneId)
    applyIntent(event.intent)
  }))
  const [stashId, setStashId] = state<string | null>('stash', () => null)
  const [commitId, setCommitId] = state<string | null>('commit', () => null)
  // The conflict being resolved and the checkout the banner observed it in. Node changes clear it.
  const [conflict, setConflict] = createSignal<{ path: string; checkout: string } | null>(null)
  createEffect(on(activeNodeId, () => setConflict(null), { defer: true }))
  const branchRef = () => task.branch ? `refs/heads/${task.branch}` : null
  const [missingBranch, setMissingBranch] = createGitViewSignal(() => task.projectId,
    () => `pane:missing-branch:${branchRef()}`, () => false, () => task.id)
  const history = createHistoryModel(() => task.projectId, branchRef, () => task.id)
  const refreshHistory = () => {
    if (missingBranch()) { setMissingBranch(false); history.setRef(branchRef()) }
    history.refresh()
    // The operation banner reads the same checkout, and an explicit refresh is how a terminal's change shows up.
    void queryClient.invalidateQueries({ queryKey: operationKey(task.id) })
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
  return { inventory, selected, setSelected, section, setSection, stashId, setStashId, commitId, setCommitId, history, missingBranch, refreshHistory, conflict, setConflict }
}

export type GitPaneModel = ReturnType<typeof createGitPaneModel>
