import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js'
import { createInfiniteQuery, createQuery, useQueryClient } from '@tanstack/solid-query'
import { useNavigate, useParams } from '@solidjs/router'
import { createVirtualizer } from '@tanstack/solid-virtual'
import { activateTaskSignals, CHECK_TONE, checksState, clientEvents, formatRelativeTime, integrationsOptions, pathForTask, projectsOptions, registerCommands, rowHeight, watchAppearance, workspaceForProject, workspacesOptions } from '@acorn/plugin-api/client'
import { prefetchOpenPulls, schedulePullSummaryPrefetch } from './prefetch'
import { closedPullsInfiniteOptions, pullDetailOptions, pullsOptions } from './queries'
import { type Pull } from '../contract/api'
import { filterPulls } from './pullList/model'
import { prFilterFor, setPrFilter } from './pullList/filterState'
import { registerKeybindings } from '@acorn/plugin-api/ui/host'
import { githubBrowsePath } from './routes'
import './styles/pull-list.css'
import { Alert, Button, EmptyState, Icon, Input, Menu, Row, RowActions, StatusDot, UserAvatar } from '@acorn/plugin-api/ui'
import { promotePullToTask } from './pullTasks'

// Draft / open / closed, as one glyph. The list route only ever reports `open` or `closed`: GitHub's
// REST list calls a merged PR closed and the closed page carries no merged_at, so a merged PR wears
// the closed icon here. The detail header, which reads the GraphQL mirror, still says "merged".
const prState = (pull: Pull): 'draft' | 'open' | 'closed' => (pull.draft ? 'draft' : pull.state === 'open' ? 'open' : 'closed')
const PR_STATE_ICON = { draft: 'git-pull-request-draft', open: 'git-pull-request', closed: 'git-pull-request-closed' }

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

  // Promotes a PR into a task: origin github-pr, branch = headRef, pullNumber
  // (docs/workspaces-and-tasks.md § Task creation and navigation). Linear ids come from a warmed
  // detail body when there is one.
  //
  // Creates inline rather than through PromoteToTaskModal, because a PR already carries its title and
  // branch. That makes this the only place a create failure can be reported, so keep the error path:
  // a node-offline createTask otherwise throws an uncaught rejection and the click looks dead.
  const [taskError, setTaskError] = createSignal('')
  async function openAsTask(pr: Pull) {
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
    const w = await promotePullToTask(queryClient, {
      projectId,
      owner: owner(),
      repo: repo(),
      number: String(pr.number),
      headRef: pr.headRef,
    })
    activateTaskSignals(w, { pane: 'pr' })
    navigate(pathForTask(w))
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
    // --row-h-virt, read from the token. The virtualizer applies its result as an inline height, so a
    // hardcoded 36 here pins the PR list's density whatever the style pack says.
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
        <Input class="pr-filter" kind="filter" placeholder="Filter…" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
      </div>
      <Show when={taskError()}><Alert class="pr-task-error">{taskError()}</Alert></Show>
      {/* Scroll element stays mounted from first render so the virtualizer always observes it.
          Publish the ref after layout so the first observed rect has the flexed pane height. */}
      <div class="pr-list-scroll" ref={publishScrollEl}>
        <Show
          when={ready()}
          fallback={
            <Show when={!githubConnected() && (isError() || repoKnown())} fallback={<EmptyState align="start" busy={!isError()}>{isError() ? 'Failed to load PRs.' : 'Loading…'}</EmptyState>}>
              <EmptyState
                align="start"
                title="Not connected to GitHub"
                action={
                  <Button onClick={() => clientEvents.emit('presentation:open-settings', { tab: 'integrations' })}>
                    Connect GitHub
                  </Button>
                }
              >
                This node has no GitHub credential, so it cannot list pull requests.
              </EmptyState>
            </Show>
          }
        >
          <Show when={shown().length} fallback={<EmptyState align="start">No matching PRs.</EmptyState>}>
            <div class="list-reset" style={{ height: `${virt.getTotalSize()}px`, position: 'relative' }}>
              <For each={virtualRows()}>
                {({ vi, pr }) => {
                  // Reactively read the warmed detail cache (enabled:false → no fetch) so the rolled-up
                  // checks dot appears as prefetchOpenPulls seeds each PR. No checks → no dot.
                  const detail = createQuery(() => pullDetailOptions(owner(), repo(), String(pr.number), false))
                  const checks = () => detail.data?.checks ?? []
                  return (
                    // Row, not a hand-built <A>: this list and every integration browse are the same
                    // list and share one hover, selected, and box treatment. `href` keeps the real
                    // link for middle-click and copy address; `onActivate` routes the plain click.
                    <Row
                      class="pr-row"
                      href={`${githubBrowsePath(params.projectId ?? '')}/${pr.number}`}
                      onActivate={() => navigate(`${githubBrowsePath(params.projectId ?? '')}/${pr.number}`)}
                      selected={params.number === String(pr.number)}
                      onHover={(entered) => (entered ? queueRowPrefetch(pr.number) : cancelRowPrefetch())}
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)`, height: `${vi.size}px` }}
                      leading={(
                        <>
                          {/* The dot only exists once the warmed detail cache holds checks, so it
                              gets a reserved slot: otherwise every row jogs sideways as the
                              prefetch lands. */}
                          <span class="pr-check">
                            <Show when={checks().length}>
                              <StatusDot tone={CHECK_TONE[checksState(checks())]} label={`Checks: ${checksState(checks())}`} />
                            </Show>
                          </span>
                          <Icon class={`pr-state pr-state-${prState(pr)}`} name={PR_STATE_ICON[prState(pr)]} title={prState(pr)} size={14} />
                          {/* The author column is gone, so the avatar carries the login on hover. */}
                          <span class="pr-avatar" title={pr.author ?? undefined}><UserAvatar login={pr.author} /></span>
                          <span class="pr-num">#{pr.number}</span>
                        </>
                      )}
                      meta={<span class="ui-row-field">{formatRelativeTime(pr.updatedAt)}</span>}
                      metaFields={1}
                      trailing={(
                        <Show when={pr.headRef}>
                          <RowActions ariaLabel={`Actions for pull request #${pr.number}`}>
                            {(menu) => (
                              <Menu.Item context={menu} onSelect={() => void openAsTask(pr)}>
                                Create task
                              </Menu.Item>
                            )}
                          </RowActions>
                        </Show>
                      )}
                      title={pr.title}
                    >
                      {pr.title}
                    </Row>
                  )
                }}
              </For>
            </div>
          </Show>
          {/* Load-more only on closed; hidden while filtering since the filter only sees loaded pages. */}
          <Show when={tab() === 'closed' && closedPulls.hasNextPage && !filter().trim()}>
            <Button
              variant="bare" class="pr-load-more"
              disabled={closedPulls.isFetchingNextPage}
              onClick={() => void closedPulls.fetchNextPage()}
            >
              {closedPulls.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          </Show>
        </Show>
      </div>
    </>
  )
}
