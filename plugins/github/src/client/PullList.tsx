import { createEffect, createMemo, createSignal, on, onCleanup, Show } from 'solid-js'
import { createInfiniteQuery, createQuery, useQueryClient } from '@tanstack/solid-query'
import { useNavigate, useParams } from '@solidjs/router'
import {
  activateTaskSignals, CHECK_TONE, checksState, clientEvents, formatRelativeTime,
  integrationsOptions, pathForTask, projectsOptions, railDotProps, workspaceForProject,
  workspacesOptions,
} from '@acorn/plugin-api/client'
import {
  Alert, Button, EmptyState, Icon, Input, Menu, Row, RowActions, Rows, StatusDot, Tabs, Text,
  Toolbar, UserAvatar,
} from '@acorn/plugin-api/ui'
import { prefetchOpenPulls, schedulePullSummaryPrefetch } from './prefetch'
import { closedPullsInfiniteOptions, pullDetailOptions, pullsOptions } from './queries'
import { type Pull } from '../shared/api'
import { filterPulls } from './pullList/model'
import { prFilterFor, setPrFilter } from './pullList/filterStore'
import { githubBrowsePath } from './clientRoutes'
import { promotePullToTask } from './pullTasks'

// Draft / open / closed, as one glyph. The list route only ever reports `open` or `closed`: GitHub's
// REST list calls a merged PR closed and the closed page carries no merged_at, so a merged PR wears
// the closed icon here. The detail header, which reads the GraphQL mirror, still says "merged".
const prState = (pull: Pull): 'draft' | 'open' | 'closed' => (pull.draft ? 'draft' : pull.state === 'open' ? 'open' : 'closed')
const PR_STATE_ICON = { draft: 'git-pull-request-draft', open: 'git-pull-request', closed: 'git-pull-request-closed' }

const LIST_TABS = [{ id: 'open', label: 'Open' }, { id: 'closed', label: 'Closed' }]

// The pull-request list for the routed repository. Access checks live on the server; this only needs
// route params before it can ask for the repo's pulls.
//
// The list is a `Rows` collection with `virtual`, so the scroller, the row placement, the arrows,
// type-ahead and the place it keeps across a refetch are all the kit's. This pane used to own a
// virtualizer, a scroll element, two animation frames and a pair of hand-registered `j` / `k`
// bindings; none of that is here now (docs/command-palette-and-shortcuts.md § Focus and typing).
export default function PullList() {
  const params = useParams()
  const navigate = useNavigate()
  // Tab and filter are kept per workspace (./pullList/filterState.ts). The active workspace is
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
  const closedPulls = createInfiniteQuery(() => closedPullsInfiniteOptions(owner(), repo(), repoKnown() && tab() === 'closed'))
  const closedRows = createMemo(() => closedPulls.data?.pages?.flatMap((page) => page.pulls) ?? [])
  const list = () => (tab() === 'open' ? (openPulls.data ?? []) : closedRows())
  const ready = () => (tab() === 'open' ? openPulls.data !== undefined : closedPulls.data !== undefined)
  const isError = () => (tab() === 'open' ? openPulls.isError : closedPulls.isError)
  // Whether this node holds a GitHub credential at all. The list already reads the integrations query
  // for the Linear seeding, so this costs nothing extra.
  const integrations = createQuery(() => integrationsOptions(true))
  const githubConnected = () =>
    (integrations.data?.integrations ?? []).some((connection) => connection.providerId === 'github' && connection.status === 'connected')

  // Once the repo is known on the repo overview, warm per-pull caches so navigating is instant.
  // Direct pull routes skip first-load warm-up so detail and files own the critical path.
  createEffect(on(
    () => (repoKnown() && !params.number ? `${owner()}/${repo()}` : ''),
    (key) => {
      if (!key) return
      const controller = new AbortController()
      void prefetchOpenPulls(queryClient, owner(), repo(), controller.signal).catch(() => {})
      onCleanup(() => controller.abort())
    },
  ))

  // Client-side text filter over the loaded tab (title / author / #number).
  const shown = createMemo(() => filterPulls(list(), filter()))
  const items = createMemo(() => shown().map((pull) => ({
    key: String(pull.number),
    label: `#${pull.number} ${pull.title}`,
  })))
  const byNumber = createMemo(() => new Map(shown().map((pull) => [String(pull.number), pull])))
  // A pull's own URL, or nothing at all without a project to hang it off. `githubBrowsePath('')` is
  // `/p/`, so the old `?? ''` built `/p//42` — which is not a broken path, it is a *different* one:
  // the empty segment falls out of the split and `/p/:projectId` matches with the pull number as the
  // project. The shell then finds no such project in the workspace and navigates to the first one,
  // and the list the reader was moving through reloads for another repository
  // (apps/tui/src/chrome/routing.ts).
  const pullPath = (number: string): string | null =>
    params.projectId ? `${githubBrowsePath(params.projectId)}/${number}` : null
  const open = (number: string) => {
    const path = pullPath(number)
    if (path) navigate(path)
  }

  // Promotes a pull into a task: origin github-pr, branch = headRef, pullNumber
  // (docs/workspaces-and-tasks.md § Task creation and navigation).
  //
  // Created inline rather than through PromoteToTaskModal, because a pull already carries its title
  // and branch. That makes this the only place a create failure can be reported, so keep the error
  // path: a node-offline createTask otherwise throws an uncaught rejection and the click looks dead.
  const [taskError, setTaskError] = createSignal('')
  async function openAsTask(pull: Pull) {
    setTaskError('')
    const projectId = params.projectId
    if (!projectId || !owner() || !repo() || !pull.headRef) return
    try {
      const task = await promotePullToTask(queryClient, {
        projectId,
        owner: owner(),
        repo: repo(),
        number: String(pull.number),
        headRef: pull.headRef,
      })
      activateTaskSignals(task, { pane: 'pr' })
      navigate(pathForTask(task))
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Could not create a task for this PR.')
    }
  }

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

  return (
    <>
      <Tabs
        tabs={LIST_TABS}
        active={tab()}
        onChange={setTab}
        idPrefix="github-pulls"
        ariaLabel="Pull request state"
      />
      {/* Under the strip rather than beside it. Open and Closed choose which list this is; the filter
          is about the list that choice produced, and squeezed into the tab row it had no room and no
          inset of its own. */}
      <Toolbar size="sm" ariaLabel="Filter pull requests">
        <Input kind="filter" placeholder="Filter…" value={filter()} onInput={setFilter} />
      </Toolbar>
      <Show when={taskError()}>{(text) => <Alert>{text()}</Alert>}</Show>
      <Show
        when={ready()}
        fallback={
          <Show
            when={!githubConnected() && (isError() || repoKnown())}
            fallback={<EmptyState align="start" busy={!isError()}>{isError() ? 'Failed to load PRs.' : 'Loading…'}</EmptyState>}
          >
            <EmptyState
              align="start"
              title="Not connected to GitHub"
              action={
                <Button onPress={() => clientEvents.emit('presentation:open-settings', { tab: 'integrations' })}>
                  Connect GitHub
                </Button>
              }
            >
              This node has no GitHub credential, so it cannot list pull requests.
            </EmptyState>
          </Show>
        }
      >
        <Show when={items().length} fallback={<EmptyState align="start">No matching PRs.</EmptyState>}>
          <Rows
            virtual
            id={`github-pulls:${owner()}/${repo()}:${tab()}`}
            ariaLabel="Pull requests"
            items={items()}
            selected={params.number ?? null}
            onSelect={open}
            onActivate={open}
          >
            {(item, itemProps, selected, place) => {
              // Not `byNumber().get(item.key)!`. A row outlives the list it was built from by the
              // width of one update: the pull list refetches under the reader — a prefetch on the row
              // they just moved to, a websocket invalidation, the refresh button — and a row whose
              // pull has left the map runs its own accessors once more before it is disposed. With
              // the assertion that read `undefined.title`, and a throw inside a row takes the whole
              // list down with it, which in a terminal is a browse panel that goes blank and says
              // nothing (apps/tui/src/panel.tsx).
              const pull = () => byNumber().get(item.key)
              // Reactively read the warmed detail cache (enabled:false → no fetch) so the rolled-up
              // checks dot appears as prefetchOpenPulls seeds each pull. No checks → no dot.
              const detail = createQuery(() => pullDetailOptions(owner(), repo(), item.key, false))
              const checks = () => detail.data?.checks ?? []
              return (
                <Show when={pull()}>
                  {(pull) => (
                    <Row
                      item={itemProps}
                      // `href` keeps the real link for middle-click and copy address; `onPress` routes
                      // the plain click.
                      {...(pullPath(item.key) ? { href: pullPath(item.key)! } : {})}
                      onPress={() => open(item.key)}
                      selected={selected()}
                      onHover={(entered) => (entered ? queueRowPrefetch(pull().number) : cancelRowPrefetch())}
                      offset={place.offset}
                      height={place.height}
                      title={pull().title}
                      label={item.label}
                      leading={
                        <>
                          <Show when={checks().length}>
                            <StatusDot {...railDotProps(CHECK_TONE[checksState(checks())])} label={`Checks: ${checksState(checks())}`} />
                          </Show>
                          <Icon name={PR_STATE_ICON[prState(pull())]} title={prState(pull())} size={14} />
                          {/* The author column is gone, so the avatar carries the login on hover. */}
                          <UserAvatar login={pull().author} />
                          <Text emphasis="muted">#{item.key}</Text>
                        </>
                      }
                      meta={<Text emphasis="muted">{formatRelativeTime(pull().updatedAt)}</Text>}
                      metaFields={1}
                      trailing={
                        <Show when={pull().headRef}>
                          <RowActions ariaLabel={`Actions for pull request #${item.key}`}>
                            {(menu) => (
                              <Menu.Item context={menu} onSelect={() => void openAsTask(pull())}>
                                Create task
                              </Menu.Item>
                            )}
                          </RowActions>
                        </Show>
                      }
                    >
                      {pull().title}
                    </Row>
                  )}
                </Show>
              )
            }}
          </Rows>
        </Show>
        {/* Load-more only on closed; hidden while filtering, since the filter only sees loaded pages. */}
        <Show when={tab() === 'closed' && closedPulls.hasNextPage && !filter().trim()}>
          <Button
            variant="bare"
            disabled={closedPulls.isFetchingNextPage}
            onPress={() => void closedPulls.fetchNextPage()}
          >
            {closedPulls.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </Show>
      </Show>
    </>
  )
}
