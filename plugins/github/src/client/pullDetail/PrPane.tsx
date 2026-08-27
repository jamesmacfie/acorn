import { createEffect, createMemo, createSignal, For, lazy, onCleanup, onMount, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { useNavigate } from '@solidjs/router'
import {
  activateTaskSignals,
  clientEvents,
  consumePaneIntent,
  openTarget,
  pathForTask,
  projectsOptions,
  tasksOptions,
  type PaneContribution,
  type Task,
  wsOnStatus,
} from '@acorn/plugin-api/client'
import { Alert, Button, Icon, Menu, SectionHeader } from '@acorn/plugin-api/ui'
import { pullDetailOptions, pullsOptions, taskPullsOptions } from '../queries'
import { parsePullRef, type PullRef } from '../../contract/pullRef'
import { pullsKey, taskPullsKey } from '../../contract/api'
import { buildTaskPullTabs, pullRefKey, taskPullTabTooltip, type TaskPullTab } from './taskPullTabs'
import { promotePullToTask } from '../pullTasks'

const PullDetail = lazy(() => import('../PullDetail'))
const DiffView = lazy(() => import('../DiffView'))

const destinationKind = (tab: TaskPullTab, currentTaskId: string): 'task' | 'agent' | 'mention' | 'stack' | null => {
  if (tab.relationship === 'primary') return null
  if (tab.linkedTasks.some((task) => task.id !== currentTaskId)) return 'task'
  if (tab.creatingAgent) return 'agent'
  if (tab.evidence.some((item) => item.kind === 'mention')) return 'mention'
  if (tab.evidence.some((item) => item.kind === 'stack')) return 'stack'
  return null
}

export function PrPane(props: { task: Task }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const primary = createMemo<PullRef | null>(() => props.task.github && props.task.pullNumber != null
    ? { owner: props.task.github.owner, repo: props.task.github.name, number: String(props.task.pullNumber) }
    : null)
  const repoEnabled = () => !!primary()
  const relations = createQuery(() => taskPullsOptions(props.task.id, repoEnabled()))
  const openPulls = createQuery(() => pullsOptions(
    primary()?.owner ?? '',
    primary()?.repo ?? '',
    'open',
    repoEnabled(),
  ))
  // The primary's conversation is the discovery anchor even while another tab is selected. Keeping
  // this observer mounted means mention tabs do not disappear when the reader follows one.
  const primaryDetail = createQuery(() => pullDetailOptions(
    primary()?.owner ?? '',
    primary()?.repo ?? '',
    primary()?.number ?? '',
    repoEnabled(),
  ))
  const tasks = createQuery(() => tasksOptions(true))
  const projects = createQuery(() => projectsOptions(true))
  const [selectedKey, setSelectedKey] = createSignal('')
  const [selectedIntent, setSelectedIntent] = createSignal<PullRef>()
  const [creatingTask, setCreatingTask] = createSignal(false)
  const [taskError, setTaskError] = createSignal('')

  let taskId = ''
  createEffect(() => {
    const next = primary()
    if (!next) return
    if (taskId !== props.task.id) {
      taskId = props.task.id
      setSelectedIntent(undefined)
      setSelectedKey(pullRefKey(next))
    }
  })

  const selectItem = (item: string) => {
    const pull = parsePullRef(item)
    if (!pull) return
    setSelectedIntent(pull)
    setSelectedKey(pullRefKey(pull))
  }
  onMount(() => {
    const initial = consumePaneIntent(props.task.id, 'pr')
    if (initial?.kind === 'plugin:select') selectItem(initial.item)
    const dispose = clientEvents.on('presentation:pane-intent', (event) => {
      if (event.taskId !== props.task.id || event.paneId !== 'pr' || event.intent.kind !== 'plugin:select') return
      consumePaneIntent(event.taskId, event.paneId)
      selectItem(event.intent.item)
    })
    const unstatus = wsOnStatus(() => {
      void queryClient.invalidateQueries({ queryKey: taskPullsKey(props.task.id) })
      const pull = primary()
      if (pull) void queryClient.invalidateQueries({ queryKey: pullsKey(pull.owner, pull.repo, 'open') })
    })
    onCleanup(() => {
      dispose()
      unstatus()
    })
  })

  const tabs = createMemo(() => {
    const anchor = primary()
    if (!anchor) return []
    return buildTaskPullTabs({
      task: props.task,
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
    selectedProjects().find((project) => project.id === props.task.projectId)
    ?? (selectedProjects().length === 1 ? selectedProjects()[0] : undefined))

  const linkedTaskRows = (tab: TaskPullTab): Task[] => {
    const ids = new Set(tab.linkedTasks.filter((task) => task.id !== props.task.id).map((task) => task.id))
    return (tasks.data ?? []).filter((task) => ids.has(task.id))
  }
  const openTask = (task: Task) => {
    activateTaskSignals(task, { pane: 'pr' })
    navigate(pathForTask(task))
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
      const task = await promotePullToTask(queryClient, {
        ...tab.pull,
        projectId: project.id,
        headRef,
      })
      openTask(task)
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Could not create a task for this pull request.')
    } finally {
      setCreatingTask(false)
    }
  }

  const moveTab = (offset: number) => {
    const rows = tabs()
    if (!rows.length) return
    const index = rows.findIndex((tab) => pullRefKey(tab.pull) === selectedKey())
    const next = rows[(index + offset + rows.length) % rows.length]
    setSelectedKey(pullRefKey(next.pull))
  }

  return (
    <div class="pr-pane">
      <Show when={tabs().length > 1}>
        <nav
          class="pr-pull-tabs ui-doctabs"
          role="tablist"
          aria-label="Task pull requests"
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault()
              moveTab(event.key === 'ArrowRight' ? 1 : -1)
            }
          }}
        >
          <For each={tabs()}>{(tab) => {
            const key = () => pullRefKey(tab.pull)
            const kind = () => destinationKind(tab, props.task.id)
            const linked = () => linkedTaskRows(tab)
            const labelIcon = () => kind() === 'mention' ? 'link-2' : kind() === 'stack' ? 'git-branch' : null
            return (
              <span class="ui-doctab" data-active={selectedKey() === key() ? '' : undefined} data-tip={taskPullTabTooltip(tab, props.task.id)}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={selectedKey() === key()}
                  tabindex={selectedKey() === key() ? 0 : -1}
                  class="ui-doctab-label"
                  onClick={() => selectTab(tab)}
                >
                  <Show when={labelIcon()}>{(icon) => <Icon name={icon()} size={13} />}</Show>
                  <span>#{tab.pull.number}</span>
                </button>
                <Show when={kind() === 'task' && linked().length === 1}>
                  <Button variant="bare" size="sm" iconOnly class="pr-pull-tab-target" aria-label={`Open ${linked()[0].title}`} onClick={() => openTask(linked()[0])}>
                    <Icon name="list-checks" size={13} />
                  </Button>
                </Show>
                <Show when={kind() === 'task' && linked().length > 1}>
                  <Menu
                    ariaLabel={`Tasks linked to #${tab.pull.number}`}
                    trigger={({ toggle }) => (
                      <Button variant="bare" size="sm" iconOnly class="pr-pull-tab-target" aria-label="Choose linked task" onClick={toggle}>
                        <Icon name="list-checks" size={13} />
                      </Button>
                    )}
                  >
                    {(menu) => <For each={linked()}>{(task) => (
                      <Menu.Item context={menu} onSelect={() => openTask(task)} leading={<Icon name="list-checks" size={13} />}>
                        {task.title}
                      </Menu.Item>
                    )}</For>}
                  </Menu>
                </Show>
                <Show when={kind() === 'agent'}>
                  <Button variant="bare" size="sm" iconOnly class="pr-pull-tab-target" aria-label="Open creating agent session" onClick={() => openAgent(tab)}>
                    <Icon name="bot" size={13} />
                  </Button>
                </Show>
              </span>
            )
          }}</For>
        </nav>
      </Show>
      <div class="pr-pane-grid">
        <section class="pane pane-mid">
          <SectionHeader actions={(
            <Show when={offersTaskCreation()}>
              <Button
                size="xs"
                disabled={creatingTask() || !selectedProject() || !selectedDetail.data?.pull?.headRef}
                title={taskCreationTitle()}
                onClick={() => void createSelectedTask()}
              >
                {creatingTask() ? 'CREATING…' : '+ TASK'}
              </Button>
            </Show>
          )}>
            Navigator
          </SectionHeader>
          <Show when={taskError()}>{(message) => <Alert class="pr-pane-task-error">{message()}</Alert>}</Show>
          <Show when={selected()}>{(tab) => <PullDetail task={props.task} pull={tab().pull} readOnly={!isPrimary()} />}</Show>
        </section>
        <section class="pane pane-right">
          <div class="section-header">Diff</div>
          <Show when={selected()}>{(tab) => <DiffView task={props.task} pull={tab().pull} readOnly={!isPrimary()} />}</Show>
        </section>
      </div>
    </div>
  )
}

export const prPaneContribution: PaneContribution = {
  id: 'pr',
  label: 'PR review',
  glyph: 'git-pull-request',
  description: 'Diff, files & review comments',
  order: 10,
  defaultChord: 'meta+shift+r',
  when: (task) => task.pullNumber != null,
  component: PrPane,
  minWidth: 520,
}
