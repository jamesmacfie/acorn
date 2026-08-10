import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js'
import { createInfiniteQuery, createQuery, useQueryClient } from '@tanstack/solid-query'
import { A, useNavigate, useParams } from '@solidjs/router'
import { createVirtualizer } from '@tanstack/solid-virtual'
import { activateTaskSignals, checksState, clientEvents, createTask, formatRelativeTime, integrationsOptions, pathForTask, projectsOptions, registerCommands, rowHeight, scanContentRefs, type Task, tasksKey, tasksOptions, watchAppearance, workspaceForProject, workspacesOptions } from '@acorn/plugin-api/client'
import { prefetchOpenPulls, schedulePullSummaryPrefetch } from './prefetch'
import { closedPullsInfiniteOptions, pullDetailOptions, pullsOptions } from './queries'
import { type Pull } from '../contract/api'
import { filterPulls } from './pullList/model'
import { prFilterFor, setPrFilter } from './pullList/filterState'
import { registerKeybindings } from '@acorn/plugin-api/ui/host'
import { githubBrowsePath } from './routes'
import './styles/pull-list.css'

// Left-pane PR list for the routed repo. Access checks live on the server; this pane only needs
// route params before it can ask for the repo's PRs. The list is virtualized in its own scroll
// container (rows are uniform var(--row-h)).
export default function PullList() {
  const params = useParams()
  const navigate = useNavigate()
  // Tab + filter are kept per workspace (features/pullList/filterState). The active workspace is
  // derived from the routed repo, so switching repos within a workspace keeps the filter and
  // switching workspaces swaps to that workspace's saved filter.
  const workspaces = createQuery(() => workspacesOptions(true))
  const projects = createQuery(() => projectsOptions(true))
  const project = () => projects.data?.find((candidate) => candidate.id === params.projectId)
  const owner = () => project()?.github?.owner ?? ''
  const repo = () => project()?.github?.name ?? ''
  const wsId = () => workspaceForProject(workspaces.data, params.projectId)?.id ?? ''
  const tab = () => prFilterFor(wsId()).tab
  const setTab = (t: 'open' | 'closed') => setPrFilter(wsId(), { tab: t })
  const filter = () => prFilterFor(wsId()).filter
  const setFilter = (f: string) => setPrFilter(wsId(), { filter: f })
  const queryClient = useQueryClient()
  const repoKnown = () => !!owner() && !!repo()
  const hasRepoParams = () => repoKnown()
  // Open: full mirror in one shot. Closed: paginated on demand (load-more), so only the active tab fetches.
  const openPulls = createQuery(() => pullsOptions(owner(), repo(), 'open', hasRepoParams() && tab() === 'open'))
  const closedPulls = createInfiniteQuery(() => closedPullsInfiniteOptions(owner(), repo(), hasRepoParams() && tab() === 'closed'))
  const closedRows = createMemo(() => closedPulls.data?.pages?.flatMap((p) => p.pulls) ?? [])
  const list = () => (tab() === 'open' ? (openPulls.data ?? []) : closedRows())
  const ready = () => (tab() === 'open' ? openPulls.data !== undefined : closedPulls.data !== undefined)
  const isError = () => (tab() === 'open' ? openPulls.isError : closedPulls.isError)
  // Whether this node holds a GitHub credential at all. The list already reads the integrations query
  // (for the Linear seeding below), so this costs nothing extra.
  const integrations = createQuery(() => integrationsOptions(true))
  const githubConnected = () =>
    (integrations.data?.integrations ?? []).some((connection) => connection.providerId === 'github' && connection.status === 'connected')

  // Once the repo is known on the repo overview, warm per-PR caches so navigating is instant.
  // Direct PR routes skip first-load warm-up so detail/files own the critical path.
  createEffect(on(
    () => (repoKnown() && !params.number ? `${owner()}/${repo()}` : ''),
    (key) => {
      if (!key) return
      const ac = new AbortController()
      void prefetchOpenPulls(queryClient, owner(), repo(), ac.signal).catch(() => {})
      onCleanup(() => ac.abort())
    },
  ))

  // Client-side text filter over the loaded tab (title / author / #number).
  const shown = createMemo(() => filterPulls(list(), filter()))

  const moveSelection = (direction: 1 | -1) => {
    const list = shown()
    if (!list.length) return
    const i = list.findIndex((p) => String(p.number) === params.number)
    const next = direction === 1 ? Math.min((i < 0 ? -1 : i) + 1, list.length - 1) : Math.max((i < 0 ? 1 : i) - 1, 0)
      navigate(`${githubBrowsePath(params.projectId ?? '')}/${list[next].number}`)
  }
  onMount(() => {
    const commands = registerCommands([
      { id: 'github.pull.next', title: 'Next pull request', category: 'navigation', run: () => moveSelection(1) },
      { id: 'github.pull.previous', title: 'Previous pull request', category: 'navigation', run: () => moveSelection(-1) },
    ])
    const bindings = registerKeybindings([
      { id: 'github.pull.next', command: 'github.pull.next', description: 'Next pull request', category: 'Pull requests', defaultChord: 'j', when: 'typing-exempt' },
      { id: 'github.pull.previous', command: 'github.pull.previous', description: 'Previous pull request', category: 'Pull requests', defaultChord: 'k', when: 'typing-exempt' },
    ])
    onCleanup(() => { bindings.dispose(); commands.dispose() })
  })

  // Flow A (docs/workspaces-and-tasks.md): promote a PR into a task. origin github-pr, branch = headRef,
  // pullNumber. Linear ids are seeded from a warmed detail body if we have one (best-effort — the
  // Linear pane that consumes them is P4); otherwise none. Then activate + navigate to the PR.
  // +TASK creates inline (no PromoteToTaskModal — a PR already carries its own title and branch), so this
  // is the only place its failure can be reported. Without it a node-offline createTask threw into an
  // uncaught rejection and the click looked like it did nothing at all.
  const [taskError, setTaskError] = createSignal('')
  async function openAsTask(e: Event, pr: Pull) {
    e.preventDefault()
    e.stopPropagation()
    setTaskError('')
    try {
      await promoteToTask(pr)
    } catch (err) {
      setTaskError(err instanceof Error ? err.message : 'Could not create a task for this PR.')
    }
  }
  async function promoteToTask(pr: Pull) {
    const projectId = params.projectId
    if (!projectId || !owner() || !repo() || !pr.headRef) return
    // If a task for this PR already exists, focus it instead of creating a duplicate.
    const existing = (await queryClient.ensureQueryData(tasksOptions(true)).catch(() => [] as Task[]))
      .find((t) => t.status === 'active' && t.origin === 'github-pr' && t.projectId === projectId && t.pullNumber === pr.number)
    if (existing) {
      activateTaskSignals(existing, { pane: 'pr' })
      return navigate(pathForTask(existing))
    }
    // Fetch the detail (cached if warm) so the body is present, then seed a task_link for EVERY
    // Linear ticket the PR references — a PR can resolve several, and the task links them all.
    //
    // The scan is provider-agnostic (the host reads every registered recogniser); the ATTRIBUTION is
    // not, and cannot be: a task link needs a connection id, and the only one derivable here is the
    // sole connected Linear. Widening this means asking each provider for its own sole connection,
    // which is a promotion-flow change rather than a scanner one.
    const detail = await queryClient.ensureQueryData(pullDetailOptions(owner(), repo(), String(pr.number), true)).catch(() => undefined)
    const integrations = await queryClient.ensureQueryData(integrationsOptions(true)).catch(() => null)
    const linears = (integrations?.integrations ?? []).filter((i) => i.providerId === 'linear' && i.status === 'connected')
    const soleLinear = linears.length === 1 ? linears[0].id : null
    const links = soleLinear
      ? scanContentRefs([detail?.pull?.body])
          .filter((r) => r.providerId === 'linear')
          .map((r) => ({ connectionId: soleLinear, identifier: r.item, ref: { displayId: r.item, url: r.url } }))
      : []
    const w = await createTask({ origin: 'github-pr', projectId, branch: pr.headRef, pullNumber: pr.number, links })
    await queryClient.invalidateQueries({ queryKey: tasksKey })
    activateTaskSignals(w, { pane: 'pr' })
    navigate(`${githubBrowsePath(projectId)}/${pr.number}`)
  }

  let rowPrefetch: { cancel: () => void } | null = null
  const cancelRowPrefetch = () => {
    rowPrefetch?.cancel()
    rowPrefetch = null
  }
  const queueRowPrefetch = (number: number) => {
    if (!owner() || !repo()) return
    cancelRowPrefetch()
    rowPrefetch = schedulePullSummaryPrefetch(queryClient, owner(), repo(), number)
  }
  onCleanup(cancelRowPrefetch)

  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement>()
  const [rowH, setRowH] = createSignal(rowHeight())
  onCleanup(watchAppearance(() => {
    setRowH(rowHeight())
    virt.measure()
  }))
  const virt = createVirtualizer({
    get count() {
      return shown().length
    },
    getScrollElement: () => scrollEl() ?? null,
    // --row-h-virt, read from the token: the virtualizer applies its result as an inline height,
    // so a hardcoded 36 here silently pinned the PR list's density regardless of the style pack.
    estimateSize: () => rowH(),
    overscan: 12,
  })
  let publishFrame = 0
  let measureFrame = 0
  onCleanup(() => {
    cancelAnimationFrame(publishFrame)
    cancelAnimationFrame(measureFrame)
  })
  const publishScrollEl = (el: HTMLDivElement) => {
    cancelAnimationFrame(publishFrame)
    publishFrame = requestAnimationFrame(() => {
      setScrollEl(el)
      virt.measure()
    })
  }
  const measureSoon = () => {
    cancelAnimationFrame(measureFrame)
    measureFrame = requestAnimationFrame(() => virt.measure())
  }
  const resetVirtualList = () => {
    const el = scrollEl()
    if (el) {
      el.scrollTop = 0
      el.scrollLeft = 0
    }
    measureSoon()
  }
  createEffect(() => {
    if (scrollEl()) measureSoon()
  })
  createEffect(on([tab, filter], resetVirtualList, { defer: true }))
  createEffect(on(() => shown().length, measureSoon, { defer: true }))
  const virtualRows = createMemo(() => {
    const list = shown()
    return virt.getVirtualItems().flatMap((vi) => {
      const pr = list[vi.index]
      return pr ? [{ vi, pr }] : []
    })
  })

  return (
    <>
      <div class="pr-tabs">
        <button type="button" classList={{ active: tab() === 'open' }} onClick={() => setTab('open')}>
          Open
        </button>
        <button type="button" classList={{ active: tab() === 'closed' }} onClick={() => setTab('closed')}>
          Closed
        </button>
        <input class="pr-filter" placeholder="Filter…" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
      </div>
      <Show when={taskError()}><div class="action-error" role="alert">{taskError()}</div></Show>
      {/* Scroll element stays mounted from first render so the virtualizer always observes it —
          publish the ref after layout so the first observed rect has the flexed pane height. */}
      <div class="pr-list-scroll" ref={publishScrollEl}>
        <Show
          when={ready()}
          fallback={
            <Show when={!githubConnected() && (isError() || repoKnown())} fallback={<p class="placeholder">{isError() ? 'Failed to load PRs.' : 'Loading…'}</p>}>
              <div class="placeholder pr-list-connect">
                <p>acorn is not connected to GitHub on this node.</p>
                <button
                  type="button"
                  class="ui-btn"
                  onClick={() => clientEvents.emit('presentation:open-settings', { tab: 'integrations' })}
                >
                  Connect GitHub
                </button>
              </div>
            </Show>
          }
        >
          <Show when={shown().length} fallback={<p class="placeholder">No matching PRs.</p>}>
            <div class="pr-list" style={{ height: `${virt.getTotalSize()}px`, position: 'relative' }}>
              <For each={virtualRows()}>
                {({ vi, pr }) => {
                  // Reactively read the warmed detail cache (enabled:false → no fetch) so the rolled-up
                  // checks dot appears as prefetchOpenPulls seeds each PR. No checks → no dot.
                  const detail = createQuery(() => pullDetailOptions(owner(), repo(), String(pr.number), false))
                  const checks = () => detail.data?.checks ?? []
                  return (
                    <A
                      class="pr-row"
                      classList={{ active: params.number === String(pr.number) }}
                      href={`${githubBrowsePath(params.projectId ?? '')}/${pr.number}`}
                      onFocus={() => queueRowPrefetch(pr.number)}
                      onBlur={cancelRowPrefetch}
                      onMouseEnter={() => queueRowPrefetch(pr.number)}
                      onMouseLeave={cancelRowPrefetch}
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)`, height: `${vi.size}px` }}
                    >
                      <span class="pr-num">#{pr.number}</span>
                      <Show when={checks().length}>
                        <span class={`checks-dot checks-dot-${checksState(checks())}`} />
                      </Show>
                      <span class="pr-title">{pr.title}</span>
                      <Show when={pr.draft}>
                        <span class="pr-badge">draft</span>
                      </Show>
                      <Show when={pr.author}>
                        <span class="pr-author muted">{pr.author}</span>
                      </Show>
                      <span class="pr-time muted">{formatRelativeTime(pr.updatedAt)}</span>
                      <Show when={pr.headRef}>
                        <button type="button" class="pr-ws-btn" title="Open as task" onClick={(e) => void openAsTask(e, pr)}>
                          +TASK
                        </button>
                      </Show>
                    </A>
                  )
                }}
              </For>
            </div>
          </Show>
          {/* Load-more only on closed; hidden while filtering since the filter only sees loaded pages. */}
          <Show when={tab() === 'closed' && closedPulls.hasNextPage && !filter().trim()}>
            <button
              type="button"
              class="pr-load-more"
              disabled={closedPulls.isFetchingNextPage}
              onClick={() => void closedPulls.fetchNextPage()}
            >
              {closedPulls.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          </Show>
        </Show>
      </div>
    </>
  )
}
