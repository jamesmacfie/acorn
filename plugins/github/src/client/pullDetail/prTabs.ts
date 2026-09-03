import { createEffect, createMemo, createRoot, createSignal, onCleanup } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { useNavigate } from '@solidjs/router'
import {
  activateTaskSignals, clientEvents, consumePaneIntent, onScopeEvicted, openTarget, pathForTask,
  projectsOptions, tasksOptions, type Task,
} from '@acorn/plugin-api/client'
import { pullDetailOptions, pullsOptions, taskPullsOptions } from '../queries'
import { parsePullRef, type PullRef } from '../../shared/pullRef'
import { pullsKey, taskPullsKey } from '../../shared/api'
import { buildTaskPullTabs, pullRefKey, type TaskPullTab } from './taskPullTabs'
import { promotePullToTask } from '../pullTasks'

// Which pull request the PR pane is showing, and the strip of related ones it can switch to.
//
// Held once per task rather than in the pane, because the strip is a subscription: it watches the
// socket, the task's pull relations and the pane-intent mailbox, and re-resolving all three every
// time the pane remounts would drop the pull the reader had chosen.

export type PrTabsModel = ReturnType<typeof build>

const roots = new Map<string, { model: PrTabsModel; dispose: () => void }>()

export function prTabsModel(task: Task): PrTabsModel {
  const held = roots.get(task.id)
  if (held) return held.model
  for (const [id, entry] of roots) if (id !== task.id) { entry.dispose(); roots.delete(id) }
  const entry = createRoot((dispose) => ({ model: build(task), dispose }))
  roots.set(task.id, entry)
  return entry.model
}

onScopeEvicted((event) => {
  if (event.scope !== 'task') return
  roots.get(event.taskId)?.dispose()
  roots.delete(event.taskId)
})

/** Test seam. The map is module-level, so a suite must not inherit the previous one's tabs. */
export function _resetPrTabs(): void {
  for (const entry of roots.values()) entry.dispose()
  roots.clear()
}

/** Why a related pull offers to take the reader somewhere else. Null for the primary, which is
 *  already here. */
export const destinationKind = (
  tab: TaskPullTab,
  currentTaskId: string,
): 'task' | 'agent' | 'mention' | 'stack' | null => {
  if (tab.relationship === 'primary') return null
  if (tab.linkedTasks.some((task) => task.id !== currentTaskId)) return 'task'
  if (tab.creatingAgent) return 'agent'
  if (tab.evidence.some((item) => item.kind === 'mention')) return 'mention'
  if (tab.evidence.some((item) => item.kind === 'stack')) return 'stack'
  return null
}

function build(task: Task) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const primary = createMemo<PullRef | null>(() => task.github && task.pullNumber != null
    ? { owner: task.github.owner, repo: task.github.name, number: String(task.pullNumber) }
    : null)
  const repoEnabled = () => !!primary()
  const relations = createQuery(() => taskPullsOptions(task.id, repoEnabled()))
  const openPulls = createQuery(() => pullsOptions(primary()?.owner ?? '', primary()?.repo ?? '', 'open', repoEnabled()))
  // The primary's conversation is the discovery anchor even while another tab is selected. Keeping
  // this observer mounted means mention tabs do not disappear when the reader follows one.
  const primaryDetail = createQuery(() =>
    pullDetailOptions(primary()?.owner ?? '', primary()?.repo ?? '', primary()?.number ?? '', repoEnabled()))
  const tasks = createQuery(() => tasksOptions(true))
  const projects = createQuery(() => projectsOptions(true))

  const [selectedKey, setSelectedKey] = createSignal('')
  const [selectedIntent, setSelectedIntent] = createSignal<PullRef>()
  const [creatingTask, setCreatingTask] = createSignal(false)
  const [taskError, setTaskError] = createSignal('')

  createEffect(() => {
    const next = primary()
    if (!next || selectedKey()) return
    setSelectedKey(pullRefKey(next))
  })

  const selectItem = (item: string) => {
    const pull = parsePullRef(item)
    if (!pull) return
    setSelectedIntent(pull)
    setSelectedKey(pullRefKey(pull))
  }

  // "Open this pull in the PR pane", from a content link or a dashboard row. Subscribed once per
  // task rather than once per panel, which is the other reason this model exists.
  const initial = consumePaneIntent(task.id, 'pr')
  if (initial?.kind === 'plugin:select') selectItem(initial.item)
  const offIntent = clientEvents.on('presentation:pane-intent', (event) => {
    if (event.taskId !== task.id || event.paneId !== 'pr' || event.intent.kind !== 'plugin:select') return
    consumePaneIntent(event.taskId, event.paneId)
    selectItem(event.intent.item)
  })
  // `head:changed` for this task, not the old content-free `term:status` ping. Two pull-request keys
  // were being invalidated on every terminal idle-to-working edge, on every connected client
  // (docs/performance.md § 2026-09-03 — phase 5). What actually moves a pull is a
  // commit landing in the task's worktree, which is what this event names.
  const offStatus = clientEvents.on('head:changed', (event) => {
    if (event.taskId !== task.id) return
    void queryClient.invalidateQueries({ queryKey: taskPullsKey(task.id) })
    const pull = primary()
    if (pull) void queryClient.invalidateQueries({ queryKey: pullsKey(pull.owner, pull.repo, 'open') })
  })
  onCleanup(() => {
    offIntent()
    offStatus()
  })

  const tabs = createMemo(() => {
    const anchor = primary()
    if (!anchor) return []
    return buildTaskPullTabs({
      task,
      primary: anchor,
      relations: relations.data?.pulls ?? [],
      openPulls: openPulls.data ?? [],
      primaryDetail: primaryDetail.data,
      tasks: tasks.data ?? [],
      selectedIntent: selectedIntent(),
    })
  })
  const selected = createMemo(() => tabs().find((tab) => pullRefKey(tab.pull) === selectedKey()) ?? tabs()[0])
  const tabIsPrimary = (tab: TaskPullTab | undefined) => !!primary() && !!tab && pullRefKey(primary()!) === pullRefKey(tab.pull)
  const isPrimary = () => tabIsPrimary(selected())

  const selectedDetail = createQuery(() => {
    const pull = selected()?.pull
    return pullDetailOptions(pull?.owner ?? '', pull?.repo ?? '', pull?.number ?? '', !!pull)
  })
  const selectedProjects = createMemo(() => {
    const pull = selected()?.pull
    if (!pull) return []
    return (projects.data ?? []).filter((project) =>
      project.github?.owner.toLowerCase() === pull.owner.toLowerCase()
      && project.github.name.toLowerCase() === pull.repo.toLowerCase())
  })
  const selectedProject = createMemo(() =>
    selectedProjects().find((project) => project.id === task.projectId)
    ?? (selectedProjects().length === 1 ? selectedProjects()[0] : undefined))

  const linkedTaskRows = (tab: TaskPullTab): Task[] => {
    const ids = new Set(tab.linkedTasks.filter((linked) => linked.id !== task.id).map((linked) => linked.id))
    return (tasks.data ?? []).filter((candidate) => ids.has(candidate.id))
  }
  const openTask = (next: Task) => {
    activateTaskSignals(next, { pane: 'pr' })
    navigate(pathForTask(next))
  }
  const openAgent = (tab: TaskPullTab) => {
    const agent = tab.creatingAgent
    if (!agent) return
    openTarget(agent.taskId, {
      kind: 'managed-agent',
      resourceId: agent.sessionId,
      ...(agent.requestId ? { subresourceId: agent.requestId } : {}),
    })
  }
  const selectTab = (tab: TaskPullTab) => {
    const linked = linkedTaskRows(tab)
    if (!tabIsPrimary(tab) && linked.length === 1) return openTask(linked[0])
    setTaskError('')
    setSelectedKey(pullRefKey(tab.pull))
  }

  const offersTaskCreation = () => {
    const tab = selected()
    return !!tab && !isPrimary() && linkedTaskRows(tab).length === 0
  }
  const taskCreationTitle = () => {
    if (!selectedProject()) return selectedProjects().length > 1
      ? 'This repository has several mapped projects; create the task from the repository pull-request list.'
      : 'Import or map this GitHub repository before creating a task.'
    if (!selectedDetail.data?.pull?.headRef) return selectedDetail.isError
      ? 'The pull request could not be loaded.'
      : 'Loading the pull request branch…'
    return `Create a task for #${selected()!.pull.number}`
  }
  const createSelectedTask = async () => {
    const tab = selected()
    const project = selectedProject()
    const headRef = selectedDetail.data?.pull?.headRef
    if (!tab || !project || !headRef || creatingTask()) return
    setCreatingTask(true)
    setTaskError('')
    try {
      openTask(await promotePullToTask(queryClient, { ...tab.pull, projectId: project.id, headRef }))
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Could not create a task for this pull request.')
    } finally {
      setCreatingTask(false)
    }
  }

  return {
    task,
    tabs,
    selected,
    selectedKey,
    isPrimary,
    selectTab,
    linkedTaskRows,
    openTask,
    openAgent,
    taskError,
    creatingTask,
    offersTaskCreation,
    taskCreationTitle,
    createSelectedTask,
    canCreateTask: () => !!selectedProject() && !!selectedDetail.data?.pull?.headRef,
  }
}
