import { createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { useNavigate, useParams } from '@solidjs/router'
import {
  activateTaskSignals,
  integrationsOptions,
  pathForTask,
  registerContextMenuItems,
  tasksOptions,
  type ItemRowTarget,
} from '@acorn/plugin-api/client'
import { sidebarCollapsed } from '@acorn/plugin-api/ui'
import { filterChangeRequests } from '@acorn/change-request-ui/model'
import { ChangeRequestList, type ChangeRequestListStatus } from '@acorn/change-request-ui/views'
import type { MergeRequestRow } from '../shared/api'
import { mergeRequestUrl } from '../shared/mergeRequestRef'
import { mergeRequestOptions, mergeRequestsOptions } from './queries'
import { describeFailure, gitlabHost, rememberAvatars } from './changeRequest'
import { gitlabBrowsePath } from './clientRoutes'
import { activeTaskForMergeRequest, promoteMergeRequestToTask } from './mergeRequestTasks'

// The tab and the filter, per routed project, for as long as the window is open.
const [filters, setFilters] = createSignal<Record<string, { tab: 'open' | 'closed'; filter: string }>>({})

// A project's merge requests, drawn by the shared change request list. This is GitLab's half: the
// open mirror, one page of the closed ones, each row's checks, and the row menu. The filter narrows
// what's loaded.
export default function MergeRequestList(props: { address: string }) {
  const params = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const collapsed = sidebarCollapsed('gitlab')
  const state = () => filters()[props.address] ?? { tab: 'open' as const, filter: '' }
  const update = (patch: Partial<{ tab: 'open' | 'closed'; filter: string }>) =>
    setFilters((current) => ({ ...current, [props.address]: { ...state(), ...patch } }))
  const tab = () => state().tab

  const list = createQuery(() => mergeRequestsOptions(props.address, tab(), !!props.address))
  const integrations = createQuery(() => integrationsOptions(true))
  const connected = () =>
    (integrations.data?.integrations ?? []).some(
      (entry) => entry.providerId === 'gitlab' && entry.status === 'connected',
    )
  createEffect(() =>
    rememberAvatars(Object.fromEntries((list.data ?? []).map((row) => [row.author ?? '', row.authorAvatar]))),
  )
  const rows = createMemo(() => filterChangeRequests(list.data ?? [], collapsed() ? '' : state().filter, '!'))
  const byNumber = createMemo(() => new Map((list.data ?? []).map((row) => [row.number, row])))

  const status = (): ChangeRequestListStatus => {
    if (list.data) return { kind: 'ready' }
    if (!connected() && (list.isError || !!props.address)) return { kind: 'disconnected' }
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
  const pathOf = (number: string) => (params.projectId ? `${gitlabBrowsePath(params.projectId)}/${number}` : null)
  const open = (number: string) => {
    const to = pathOf(number)
    if (to) navigate(to)
  }

  const [taskError, setTaskError] = createSignal('')
  async function openAsTask(row: MergeRequestRow, skipSetup = false) {
    setTaskError('')
    if (!params.projectId) return
    try {
      const headRef =
        row.headRef ??
        (await queryClient.fetchQuery(mergeRequestOptions(props.address, String(row.number), true))).request?.headRef
      if (!headRef) throw new Error("This merge request's branch isn't available, so a task can't be created for it.")
      const task = await promoteMergeRequestToTask(queryClient, {
        projectId: params.projectId,
        address: props.address,
        number: row.number,
        headRef,
        title: row.title,
        skipSetup,
      })
      activateTaskSignals(task, { pane: 'mr' })
      navigate(pathForTask(task))
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : "Couldn't create a task for this merge request.")
    }
  }

  const rowTarget = (row: MergeRequestRow, body?: string | null): ItemRowTarget => ({
    location: 'item.row',
    id: String(row.number),
    title: `!${row.number} ${row.title}`,
    providerId: 'gitlab',
    projectId: params.projectId ?? '',
    ...(body ? { body } : {}),
    link: mergeRequestUrl(props.address, row.number),
    item: row,
  })
  const tasks = createQuery(() => tasksOptions(true))
  const tracked = (target: ItemRowTarget) =>
    !!params.projectId && !!activeTaskForMergeRequest(tasks.data ?? [], params.projectId, Number(target.id))
  onMount(() => {
    const isMergeRequest = (target: ItemRowTarget) =>
      target.providerId === 'gitlab' && typeof (target.item as MergeRequestRow).number === 'number'
    const menu = registerContextMenuItems([
      {
        id: 'gitlab.merge-request.create-task',
        location: 'item.row',
        label: 'Create task',
        icon: 'square-plus',
        order: 10,
        when: (target) => isMergeRequest(target) && !tracked(target),
        run: (target) => void openAsTask(target.item as MergeRequestRow),
      },
      {
        id: 'gitlab.merge-request.create-task-without-setup',
        location: 'item.row',
        label: 'Create task without setup',
        icon: 'square-plus',
        order: 11,
        when: (target) => isMergeRequest(target) && !tracked(target),
        run: (target) => void openAsTask(target.item as MergeRequestRow, true),
      },
      {
        id: 'gitlab.merge-request.open-task',
        location: 'item.row',
        label: 'Open task',
        icon: 'list-checks',
        order: 10,
        when: (target) => isMergeRequest(target) && tracked(target),
        run: (target) => void openAsTask(target.item as MergeRequestRow),
      },
    ])
    onCleanup(() => menu.dispose())
  })

  return (
    <ChangeRequestList
      host={gitlabHost}
      idPrefix="gitlab-mrs"
      collapsed={collapsed}
      tab={tab}
      setTab={(next) => update({ tab: next })}
      filter={() => state().filter}
      setFilter={(next) => update({ filter: next })}
      searching={() => false}
      notice={() => undefined}
      emptyText={() =>
        state().filter.trim()
          ? 'No merge requests match.'
          : tab() === 'open'
            ? 'No open merge requests.'
            : 'No closed merge requests.'
      }
      taskError={taskError}
      status={status}
      rows={rows}
      listKey={() => `${props.address}:${tab()}`}
      selected={() => params.number ?? null}
      href={pathOf}
      onOpen={open}
      rowDetail={(number) => {
        // The warmed detail, when there is one; the list's own pipeline status otherwise.
        const detail = createQuery(() => mergeRequestOptions(props.address, number, false))
        return {
          checks: () => {
            const known = detail.data?.checks
            if (known) return known
            const pipeline = byNumber().get(Number(number))?.pipelineStatus
            return pipeline ? [{ name: 'Pipeline', status: pipeline, url: null, runId: null }] : []
          },
          body: () => detail.data?.request?.body,
        }
      }}
      rowTarget={(row, body) =>
        rowTarget(byNumber().get(row.number) ?? { ...row, authorAvatar: null, pipelineStatus: null }, body)
      }
    />
  )
}
