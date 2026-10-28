import { createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { useNavigate, useParams } from '@solidjs/router'
import {
  activateTaskSignals,
  formatRelativeTime,
  integrationsOptions,
  pathForTask,
  registerContextMenuItems,
  tasksOptions,
  type ItemRowTarget,
} from '@acorn/plugin-api/client'
import { sidebarCollapsed } from '@acorn/plugin-api/ui'
import { filterChangeRequests } from '@acorn/change-request-ui/model'
import { ChangeRequestList, type ChangeRequestListStatus } from '@acorn/change-request-ui/views'
import type { PullRequestRow } from '../shared/api'
import { pullRequestUrl } from '../shared/pullRequestRef'
import { pullRequestOptions, pullRequestsOptions } from './queries'
import { bitbucketHost, describeFailure, rememberAvatars } from './changeRequest'
import { bitbucketBrowsePath } from './clientRoutes'
import { activeTaskForPullRequest, promotePullRequestToTask } from './pullRequestTasks'

// The open list refreshes within a minute. A copy older than this means Bitbucket hasn't answered the
// refreshes since, most often because of its hourly rate limit, and the list says so.
const STALE_NOTICE_MS = 5 * 60_000

// The tab and the filter, per routed project, for as long as the window is open.
const [filters, setFilters] = createSignal<Record<string, { tab: 'open' | 'closed'; filter: string }>>({})

// A repository's pull requests, drawn by the shared change request list. This is Bitbucket's half: the
// open mirror, one page of the closed ones, each row's checks once its detail is read, and the row
// menu. The filter narrows what's loaded.
export default function PullRequestList(props: { repository: string }) {
  const params = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const collapsed = sidebarCollapsed('bitbucket')
  const state = () => filters()[props.repository] ?? { tab: 'open' as const, filter: '' }
  const update = (patch: Partial<{ tab: 'open' | 'closed'; filter: string }>) =>
    setFilters((current) => ({ ...current, [props.repository]: { ...state(), ...patch } }))
  const tab = () => state().tab

  const list = createQuery(() => pullRequestsOptions(props.repository, tab(), !!props.repository))
  const integrations = createQuery(() => integrationsOptions(true))
  const connected = () =>
    (integrations.data?.integrations ?? []).some(
      (entry) => entry.providerId === 'bitbucket' && entry.status === 'connected',
    )
  createEffect(() =>
    rememberAvatars(Object.fromEntries((list.data?.rows ?? []).map((row) => [row.author ?? '', row.authorAvatar]))),
  )
  const rows = createMemo(() => filterChangeRequests(list.data?.rows ?? [], collapsed() ? '' : state().filter, '#'))
  const byNumber = createMemo(() => new Map((list.data?.rows ?? []).map((row) => [row.number, row])))

  const status = (): ChangeRequestListStatus => {
    if (list.data) return { kind: 'ready' }
    if (!connected() && (list.isError || !!props.repository)) return { kind: 'disconnected' }
    if (list.isError) {
      const failure = describeFailure(list.error)
      return {
        kind: 'failed',
        reason: failure.text,
        reconnect: failure.code === 'reauth',
        retry: () => void list.refetch(),
      }
    }
    return { kind: 'loading' }
  }
  const pathOf = (number: string) => (params.projectId ? `${bitbucketBrowsePath(params.projectId)}/${number}` : null)
  const open = (number: string) => {
    const to = pathOf(number)
    if (to) navigate(to)
  }

  const [taskError, setTaskError] = createSignal('')
  async function openAsTask(row: PullRequestRow, skipSetup = false) {
    setTaskError('')
    if (!params.projectId) return
    try {
      if (!row.headRef)
        throw new Error("This pull request's branch isn't available, so a task can't be created for it.")
      const task = await promotePullRequestToTask(queryClient, {
        projectId: params.projectId,
        repository: props.repository,
        number: row.number,
        headRef: row.headRef,
        sourceRepository: row.sourceRepository,
        title: row.title,
        skipSetup,
      })
      activateTaskSignals(task, { pane: 'bitbucket-pr' })
      navigate(pathForTask(task))
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : "Couldn't create a task for this pull request.")
    }
  }

  const rowTarget = (row: PullRequestRow, body?: string | null): ItemRowTarget => ({
    location: 'item.row',
    id: String(row.number),
    title: `#${row.number} ${row.title}`,
    providerId: 'bitbucket',
    projectId: params.projectId ?? '',
    ...(body ? { body } : {}),
    link: pullRequestUrl(props.repository, row.number),
    item: row,
  })
  const tasks = createQuery(() => tasksOptions(true))
  const tracked = (target: ItemRowTarget) =>
    !!params.projectId && !!activeTaskForPullRequest(tasks.data ?? [], params.projectId, Number(target.id))
  onMount(() => {
    const isPullRequest = (target: ItemRowTarget) =>
      target.providerId === 'bitbucket' && typeof (target.item as PullRequestRow).number === 'number'
    const menu = registerContextMenuItems([
      {
        id: 'bitbucket.pull-request.create-task',
        location: 'item.row',
        label: 'Create task',
        icon: 'square-plus',
        order: 10,
        when: (target) => isPullRequest(target) && !tracked(target),
        run: (target) => void openAsTask(target.item as PullRequestRow),
      },
      {
        id: 'bitbucket.pull-request.create-task-without-setup',
        location: 'item.row',
        label: 'Create task without setup',
        icon: 'square-plus',
        order: 11,
        when: (target) => isPullRequest(target) && !tracked(target),
        run: (target) => void openAsTask(target.item as PullRequestRow, true),
      },
      {
        id: 'bitbucket.pull-request.open-task',
        location: 'item.row',
        label: 'Open task',
        icon: 'list-checks',
        order: 10,
        when: (target) => isPullRequest(target) && tracked(target),
        run: (target) => void openAsTask(target.item as PullRequestRow),
      },
    ])
    onCleanup(() => menu.dispose())
  })

  return (
    <ChangeRequestList
      host={bitbucketHost}
      idPrefix="bitbucket-prs"
      collapsed={collapsed}
      tab={tab}
      setTab={(next) => update({ tab: next })}
      filter={() => state().filter}
      setFilter={(next) => update({ filter: next })}
      searching={() => false}
      notice={() => {
        const fetchedAt = list.data?.fetchedAt
        return tab() === 'open' && fetchedAt && Date.now() - fetchedAt > STALE_NOTICE_MS
          ? `Bitbucket last answered ${formatRelativeTime(fetchedAt)}. It may be limiting requests, so this list can be out of date.`
          : undefined
      }}
      emptyText={() =>
        state().filter.trim()
          ? 'No pull requests match.'
          : tab() === 'open'
            ? 'No open pull requests.'
            : 'No closed pull requests.'
      }
      taskError={taskError}
      status={status}
      rows={rows}
      listKey={() => `${props.repository}:${tab()}`}
      selected={() => params.number ?? null}
      href={pathOf}
      onOpen={open}
      // A row's statuses are a request of their own, so a row shows them only once its detail is read.
      rowDetail={(number) => {
        const detail = createQuery(() => pullRequestOptions(props.repository, number, false))
        return { checks: () => detail.data?.checks ?? [], body: () => detail.data?.request?.body }
      }}
      rowTarget={(row, body) =>
        rowTarget(byNumber().get(row.number) ?? { ...row, authorAvatar: null, sourceRepository: null }, body)
      }
    />
  )
}
