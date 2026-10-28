import { createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js'
import { createInfiniteQuery, createQuery, useQueryClient } from '@tanstack/solid-query'
import { useNavigate, useParams } from '@solidjs/router'
import {
  activateTaskSignals,
  integrationsOptions,
  pathForTask,
  projectsOptions,
  registerContextMenuItems,
  tasksOptions,
  workspaceForProject,
  workspacesOptions,
  type ItemRowTarget,
} from '@acorn/plugin-api/client'
import { sidebarCollapsed } from '@acorn/plugin-api/ui'
import { debounce } from '@acorn/plugin-api/client'
import {
  DEFAULT_COMMAND_SEARCH_DEBOUNCE_MS,
  DEFAULT_COMMAND_SEARCH_MIN_QUERY,
  MAX_COMMAND_SEARCH_QUERY,
} from '@acorn/protocol/commands.ts'
import { filterChangeRequests } from '@acorn/change-request-ui/model'
import { ChangeRequestList, type ChangeRequestListStatus } from '@acorn/change-request-ui/views'
import { prefetchOpenPulls, schedulePullSummaryPrefetch } from './prefetch'
import { closedPullsInfiniteOptions, pullDetailOptions, pullSearchOptions, pullsOptions } from './queries'
import { type Pull } from '../shared/api'
import { prFilterFor, setPrFilter } from './pullList/filterStore'
import { githubBrowsePath } from './clientRoutes'
import { activeTaskForPull, promotePullToTask } from './pullTasks'
import { readFailure } from './actionErrors'
import { githubHost, toSummary } from './changeRequest'

// The list route only ever reports `open` or `closed`: GitHub's REST list calls a merged PR closed and
// the closed page carries no merged_at, so a merged PR wears the closed icon here. The detail header,
// which reads the GraphQL mirror, still says "merged".

// The pull-request list for the routed repository. Access checks live on the server.
//
// The rows are the shared change request list's. This is GitHub's half: the open mirror, the closed
// pages, GitHub's search, the per-row checks from the warmed detail cache, and the row menu.
export default function PullList() {
  const params = useParams()
  // The same signal the source's list column reads, so the rows narrow exactly when the column does.
  // Keyed by the source id this plugin registers.
  const collapsed = sidebarCollapsed('github')
  const navigate = useNavigate()
  // Tab and filter are kept per workspace (`prFilterFor`). The active workspace is
  // derived from the routed repo, so switching repos within a workspace keeps the filter and
  // switching workspaces swaps to that workspace's saved filter.
  const workspaces = createQuery(() => workspacesOptions(true))
  const projects = createQuery(() => projectsOptions(true))
  const project = () => projects.data?.find((candidate) => candidate.id === params.projectId)
  const owner = () => project()?.github?.owner ?? ''
  const repo = () => project()?.github?.name ?? ''
  const wsId = () => workspaceForProject(workspaces.data, params.projectId)?.id ?? ''
  const tab = () => prFilterFor(wsId()).tab
  const setTab = (next: string) => setPrFilter(wsId(), { tab: next === 'closed' ? 'closed' : 'open' })
  const filter = () => prFilterFor(wsId()).filter
  const setFilter = (next: string) => setPrFilter(wsId(), { filter: next })
  const queryClient = useQueryClient()
  const repoKnown = () => !!owner() && !!repo()
  // Open: the full mirror in one shot. Closed: paginated on demand, so only the active tab fetches.
  const openPulls = createQuery(() => pullsOptions(owner(), repo(), 'open', repoKnown() && tab() === 'open'))
  const closedPulls = createInfiniteQuery(() =>
    closedPullsInfiniteOptions(owner(), repo(), repoKnown() && tab() === 'closed'),
  )
  const closedRows = createMemo(() => closedPulls.data?.pages?.flatMap((page) => page.pulls) ?? [])
  const list = () => (tab() === 'open' ? (openPulls.data ?? []) : closedRows())
  const ready = () => (tab() === 'open' ? openPulls.data !== undefined : closedPulls.data !== undefined)
  const isError = () => (tab() === 'open' ? openPulls.isError : closedPulls.isError)
  const listErrorCode = () => {
    const error = tab() === 'open' ? openPulls.error : closedPulls.error
    const code = (error as { code?: unknown } | null)?.code
    return typeof code === 'string' ? code : undefined
  }
  const listFailure = () => readFailure(tab() === 'open' ? openPulls.error : closedPulls.error)
  const retry = () => (tab() === 'open' ? openPulls.refetch() : closedPulls.refetch())
  // Whether this node holds a GitHub credential at all.
  const integrations = createQuery(() => integrationsOptions(true))
  const githubConnected = () =>
    (integrations.data?.integrations ?? []).some(
      (connection) => connection.providerId === 'github' && connection.status === 'connected',
    )

  // Once the repo is known on the repo overview, warm per-pull caches so navigating is instant.
  // Direct pull routes skip first-load warm-up so detail and files own the critical path.
  createEffect(
    on(
      () => (repoKnown() && !params.number ? `${owner()}/${repo()}` : ''),
      (key) => {
        if (!key) return
        const controller = new AbortController()
        void prefetchOpenPulls(queryClient, owner(), repo(), controller.signal).catch(() => {})
        onCleanup(() => controller.abort())
      },
    ),
  )

  // Search: the loaded tab narrows as the reader types (title / author / #number), and once the text
  // settles GitHub is asked for matches past the loaded pages, in this repository and tab. Its hits
  // are added after the local matches, never swapped in: GitHub matches whole words and not authors,
  // so a loaded pull that plainly matches would vanish. Collapsed, the field is out of sight, so
  // nothing is filtered or searched.
  const searchText = () => (collapsed() ? '' : filter().trim())
  const outbound = () => {
    const query = searchText().slice(0, MAX_COMMAND_SEARCH_QUERY)
    return query.length >= DEFAULT_COMMAND_SEARCH_MIN_QUERY ? query : ''
  }
  const [settled, setSettled] = createSignal('')
  const settle = debounce(setSettled, DEFAULT_COMMAND_SEARCH_DEBOUNCE_MS)
  onCleanup(settle.cancel)
  createEffect(() => {
    const query = outbound()
    if (query) settle(query)
    else {
      settle.cancel()
      setSettled('')
    }
  })
  // Keyed by repository, tab and text, so an answer for another scope is never drawn for this one.
  const search = createQuery(() =>
    pullSearchOptions(owner(), repo(), tab(), settled(), repoKnown() && !!settled() && settled() === outbound()),
  )
  const searchStatus = (): 'idle' | 'local' | 'searching' | 'done' | 'failed' => {
    if (!searchText()) return 'idle'
    if (!outbound()) return 'local'
    if (settled() !== outbound() || search.isPending) return 'searching'
    return search.isError ? 'failed' : 'done'
  }
  const shown = createMemo(() => {
    const local = filterChangeRequests(list(), searchText(), '#')
    if (searchStatus() !== 'done') return local
    const seen = new Set(local.map((pull) => pull.number))
    return [...local, ...(search.data?.pulls ?? []).filter((pull) => !seen.has(pull.number))]
  })
  const searchNotice = () => {
    if (searchStatus() === 'failed') return "Couldn't search GitHub. Showing loaded matches."
    if (searchStatus() === 'done' && search.data?.incomplete) {
      return `GitHub has ${search.data.total} matches. Add to the search to narrow it.`
    }
    return undefined
  }
  const byNumber = createMemo(() => new Map(shown().map((pull) => [pull.number, pull])))
  // A pull's own URL, or nothing at all without a project to hang it off. An empty project builds
  // `/p//42`, which is not a broken path but a different one: the empty segment falls out of the split
  // and `/p/:projectId` matches with the pull number as the project. The shell then finds no such
  // project and navigates to the first one, so the list reloads for another repository.
  const pullPath = (number: string): string | null =>
    params.projectId ? `${githubBrowsePath(params.projectId)}/${number}` : null
  const open = (number: string) => {
    const path = pullPath(number)
    if (path) navigate(path)
  }

  // Promotes a pull into a task: origin github-pr, branch = headRef, pullNumber
  // (docs/workspaces-and-tasks/task-creation.md § Task creation and navigation).
  //
  // Created inline rather than through PromoteToTaskModal, because a pull already carries its title
  // and branch. That makes this the only place a create failure can be reported, so keep the error
  // path: a node-offline createTask otherwise throws an uncaught rejection and the click looks dead.
  const [taskError, setTaskError] = createSignal('')
  // A search hit carries no branch, so its detail is read first rather than inventing one.
  async function openAsTask(pull: Pull, skipSetup = false) {
    setTaskError('')
    const projectId = params.projectId
    if (!projectId || !owner() || !repo()) return
    try {
      const headRef =
        pull.headRef ??
        (await queryClient.fetchQuery(pullDetailOptions(owner(), repo(), String(pull.number), true))).pull?.headRef
      if (!headRef) throw new Error("This pull request's branch isn't available, so a task can't be created for it.")
      const task = await promotePullToTask(queryClient, {
        projectId,
        owner: owner(),
        repo: repo(),
        number: String(pull.number),
        headRef,
        skipSetup,
      })
      activateTaskSignals(task, { pane: 'pr' })
      navigate(pathForTask(task))
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : "Couldn't create a task for this pull request.")
    }
  }

  // What a row's menu is about, in the shape core's rail list uses, so one registry serves both
  // (docs/plugins/menus-and-markers.md § Context menus). The pull itself rides along as `item`; only `providerId` and
  // `projectId` are facts a contributed row may match on.
  //
  // `body` comes from the warmed detail cache when the row has one, because the list route does not
  // carry a pull's body and asking for a hundred of them to fill a menu nobody opened would be a
  // worse trade than a menu that sometimes starts a workflow with the title alone.
  const rowTarget = (pull: Pick<Pull, 'number' | 'title'>, body?: string | null): ItemRowTarget => ({
    location: 'item.row',
    id: String(pull.number),
    title: `#${pull.number} ${pull.title}`,
    providerId: 'github',
    projectId: params.projectId ?? '',
    ...(body ? { body } : {}),
    ...(owner() && repo() ? { link: `https://github.com/${owner()}/${repo()}/pull/${pull.number}` } : {}),
    item: pull,
  })

  // Whether a task already tracks a row's pull, so its menu says Open task rather than offering to
  // make a second one. The same rule `promotePullToTask` uses to find that task.
  const tasks = createQuery(() => tasksOptions(true))
  const tracked = (target: ItemRowTarget) =>
    !!params.projectId && !!activeTaskForPull(tasks.data ?? [], params.projectId, Number(target.id))

  onMount(() => {
    // This list's own row actions go on the registry, beside whatever else offers an `item.row`
    // action. Two registrations with opposite checks, so the label says which of the two it will do.
    const isPull = (target: ItemRowTarget) =>
      target.providerId === 'github' && typeof (target.item as Pull).number === 'number'
    const rows = registerContextMenuItems([
      {
        id: 'github.pull.create-task',
        location: 'item.row',
        label: 'Create task',
        icon: 'square-plus',
        order: 10,
        when: (target) => isPull(target) && !tracked(target),
        run: (target) => void openAsTask(target.item as Pull),
      },
      {
        id: 'github.pull.create-task-without-setup',
        location: 'item.row',
        label: 'Create task without setup',
        icon: 'square-plus',
        order: 11,
        when: (target) => isPull(target) && !tracked(target),
        run: (target) => void openAsTask(target.item as Pull, true),
      },
      {
        id: 'github.pull.open-task',
        location: 'item.row',
        label: 'Open task',
        icon: 'list-checks',
        order: 10,
        when: (target) => isPull(target) && tracked(target),
        run: (target) => void openAsTask(target.item as Pull),
      },
    ])
    onCleanup(() => rows.dispose())
  })

  let rowPrefetch: { cancel: () => void } | null = null
  const cancelRowPrefetch = () => {
    rowPrefetch?.cancel()
    rowPrefetch = null
  }
  const queueRowPrefetch = (number: number) => {
    if (!repoKnown()) return
    cancelRowPrefetch()
    rowPrefetch = schedulePullSummaryPrefetch(queryClient, owner(), repo(), number)
  }
  onCleanup(cancelRowPrefetch)

  const status = (): ChangeRequestListStatus => {
    if (ready()) return { kind: 'ready' }
    if (!githubConnected() && (isError() || repoKnown())) return { kind: 'disconnected' }
    if (isError())
      return {
        kind: 'failed',
        reason: listFailure(),
        reconnect: listErrorCode() === 'reauth',
        retry: () => void retry(),
      }
    return { kind: 'loading' }
  }

  return (
    <ChangeRequestList
      host={githubHost}
      idPrefix="github-pulls"
      collapsed={collapsed}
      tab={tab}
      setTab={setTab}
      filter={filter}
      setFilter={setFilter}
      searching={() => searchStatus() === 'searching'}
      notice={searchNotice}
      emptyText={() =>
        searchStatus() === 'idle'
          ? tab() === 'open'
            ? 'No open pull requests.'
            : 'No closed pull requests.'
          : searchStatus() === 'failed'
            ? "No loaded pull requests match, and GitHub couldn't be searched."
            : 'No pull requests match.'
      }
      taskError={taskError}
      status={status}
      rows={() => shown().map(toSummary)}
      listKey={() => `${owner()}/${repo()}:${tab()}`}
      selected={() => params.number ?? null}
      href={pullPath}
      onOpen={open}
      onHover={(number, entered) => (entered ? queueRowPrefetch(number) : cancelRowPrefetch())}
      rowDetail={(number) => {
        // Reactively read the warmed detail cache (enabled:false → no fetch) so the rolled-up
        // checks dot appears as prefetchOpenPulls seeds each pull. No checks → no dot.
        const detail = createQuery(() => pullDetailOptions(owner(), repo(), number, false))
        return { checks: () => detail.data?.checks ?? [], body: () => detail.data?.pull?.body }
      }}
      rowTarget={(row, body) => rowTarget(byNumber().get(row.number) ?? row, body)}
      loadMore={{
        shown: () => tab() === 'closed' && !!closedPulls.hasNextPage && !filter().trim(),
        busy: () => closedPulls.isFetchingNextPage,
        run: () => void closedPulls.fetchNextPage(),
      }}
    />
  )
}
