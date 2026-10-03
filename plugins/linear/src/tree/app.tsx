import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { Button, DetailColumn, EmptyState, ListColumn, ListDetail, Row } from '@acorn/plugin-api/ui/tree'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import type { Task } from '@acorn/protocol/api.ts'
import type { PluginRefResolutionBody } from '@acorn/protocol/refResolvers.ts'
import {
  linearCommentsRoute,
  linearIssueRoute,
  linearIssuesRoute,
  type LinearIssueDetail,
  type LinearIssuesRequest,
} from '../shared/api'
import { parseLinearRailItemId, type LinearRailTarget } from '../shared/rail'
import { canonicalIdentifier, failureReason, linearIdentifierFromHref, targetKey, taskLinearTargets } from './model'
import { LinearIssueView } from './LinearIssueView'

// One renderer, three manifest surfaces, told apart by what the host mounted this slot with
// (docs/integrations/linear.md § Linear).
//
//   refPanel   `item`, unscoped: resolved across every connected workspace.
//   pane       `item` from a rail row, or `taskId` for whatever the task links.
//
// Both pane surfaces come through the same branch: the project surface arrives with an `item` and no
// `taskId`, the same shape a rail selection into a task pane takes.
//
// The mount props, not `bridge.context`: one worker serves every tree this bundle draws and so holds
// one bridge, which makes the context the bundle's and the props this slot's.
//
// A selection into an already-mounted pane arrives as `onSelect` rather than new props, because
// remounting per click would throw away everything drawn so far.

type Target = { connectionId?: string; identifier: string }

type Page =
  | { kind: 'empty'; title: string }
  | { kind: 'loading' }
  | { kind: 'error'; title: string; detail: string; retry?: () => void }

/** What the host mounts this tree with: the surface's subject, minted by the shell per slot. */
export type LinearPaneProps = { taskId?: string; item?: string }

export function LinearIssuePane(props: LinearPaneProps & { bridge: AcornBridge }) {
  const [linked, setLinked] = createSignal<LinearRailTarget[]>([])
  const [target, setTarget] = createSignal<Target | null>(null)
  const [issue, setIssue] = createSignal<LinearIssueDetail | null>(null)
  const [page, setPage] = createSignal<Page>({ kind: 'loading' })
  const [activeTab, setActiveTab] = createSignal('overview')
  // A relation row re-points the detail request without disturbing which ticket the host opened, so
  // the back affordance has somewhere to return to and a later `onSelect` lands on the host's choice.
  const [override, setOverride] = createSignal<string | null>(null)
  const [refreshing, setRefreshing] = createSignal(false)
  const [refreshError, setRefreshError] = createSignal('')
  const [posting, setPosting] = createSignal(false)
  const [postError, setPostError] = createSignal('')
  // The linked issues' titles, for the task pane's list, keyed by identifier.
  const [titles, setTitles] = createSignal<Record<string, string>>({})
  let load = 0

  const activeIdentifier = () => override() ?? target()?.identifier ?? ''

  // A new issue clears the old one before the fetch, so the detail never shows one issue while the list
  // has selected another, and a comment typed in that gap has no composer to land in. A refresh
  // (`keep`) leaves the issue on screen and reports a failure above it, as rollbar's `keepView` does.
  const fetchIssue = async (identifier: string, connectionId?: string, keep = false): Promise<void> => {
    const request = ++load
    setRefreshError('')
    if (!keep) {
      setIssue(null)
      setPage({ kind: 'loading' })
    }
    try {
      const detail = await props.bridge.api.get<LinearIssueDetail>(linearIssueRoute(identifier, connectionId))
      if (request !== load) return
      setIssue(detail)
    } catch (error) {
      if (request !== load) return
      if (keep && issue()) {
        setRefreshError(failureReason(error))
        return
      }
      setIssue(null)
      setPage({
        kind: 'error',
        title: "Couldn't load this issue",
        detail: failureReason(error),
        retry: () => void fetchIssue(identifier, connectionId),
      })
    }
  }

  /** Point the whole view at a ticket the host named: clears the relation override and the tab. */
  const open = (next: Target): void => {
    setOverride(null)
    setActiveTab('overview')
    setPostError('')
    setTarget(next)
    void fetchIssue(canonicalIdentifier(next.identifier), next.connectionId)
  }

  const openRelated = (identifier: string): void => {
    setOverride(canonicalIdentifier(identifier))
    setActiveTab('overview')
    void fetchIssue(canonicalIdentifier(identifier), target()?.connectionId)
  }

  // A linear.app ticket link stays local rather than going through the host (docs/integrations/linear.md §
  // Linear). Re-pointing in place is what makes the back affordance work. Everything else goes over
  // the bridge to the host's in-app-or-browser resolution.
  //
  // The href arrives through `Markdown`'s `onSelect`, one of the kit's eleven events: a tree cannot be
  // handed a DOM event, and it does not need one — the link's destination is the whole question.
  const onLink = (href: string): void => {
    const identifier = linearIdentifierFromHref(href)
    if (identifier) return openRelated(identifier)
    void props.bridge.ui.openUrl(href)
  }

  const refresh = async (): Promise<void> => {
    if (refreshing()) return
    setRefreshing(true)
    try {
      await fetchIssue(activeIdentifier(), target()?.connectionId, true)
    } finally {
      setRefreshing(false)
    }
  }

  const comment = async (body: string, parentId?: string): Promise<void> => {
    // Captured before the post, so the refetch after it cannot re-point a view the reader has since
    // moved to another issue.
    const identifier = activeIdentifier()
    const connectionId = target()?.connectionId
    setPosting(true)
    setPostError('')
    try {
      await props.bridge.api.post(linearCommentsRoute(identifier, connectionId), { body, parentId })
      if (activeIdentifier() === identifier) await fetchIssue(identifier, connectionId, true)
    } catch (error) {
      setPostError(`Couldn't post your comment. ${failureReason(error)}`)
    } finally {
      setPosting(false)
    }
  }

  // One batch read for every linked issue's title. A failure leaves the keys, which still work.
  const readTitles = async (targets: LinearRailTarget[]): Promise<void> => {
    try {
      const resolved = await props.bridge.api.post<PluginRefResolutionBody[]>(
        linearIssuesRoute,
        { identifiers: targets.map((entry) => entry.identifier) } satisfies LinearIssuesRequest,
      )
      setTitles(Object.fromEntries(resolved.map((entry) => [entry.identifier, entry.label])))
    } catch {
      // Keys only.
    }
  }

  const copy = async (text: string): Promise<void> => {
    await props.bridge.ui.copy(text)
    void props.bridge.ui.toast('Copied to the clipboard')
  }

  onMount(() => {
    const off = props.bridge.onSelect((item) => {
      const selected = parseLinearRailItemId(item)
      // A rail row is `<connection>:<identifier>`; a content link delivers a bare path segment. Both
      // arrive on this one channel, so both have to be accepted here.
      open(selected ?? { identifier: item })
    })
    onCleanup(off)

    void (async () => {
      // A ref panel and a rail row both arrive as `item`; a ref panel simply has no task behind it.
      if (props.item) {
        const selected = parseLinearRailItemId(props.item)
        return open(selected ?? { identifier: props.item })
      }
      // No task and no item: the project-scoped surface, sitting beside the rail list with nothing
      // addressed. `taskId` is what tells the two pane surfaces apart, because the host gives one to
      // a task pane and never to a project-scoped one.
      if (!props.taskId) {
        return setPage({ kind: 'empty', title: 'Choose an issue' })
      }
      try {
        const tasks = await props.bridge.api.get<Task[]>('/v1/core/tasks')
        const targets = taskLinearTargets(tasks.find((task) => task.id === props.taskId))
        setLinked(targets)
        if (targets.length > 1) void readTitles(targets)
        const first = targets[0]
        if (first) return open(first)
        setPage({ kind: 'empty', title: 'This task has no Linear issues' })
      } catch (error) {
        setPage({ kind: 'error', title: "Couldn't load this task", detail: failureReason(error) })
      }
    })()
  })

  const body = () => (
    <Show when={issue()} fallback={<PageStatus state={page()} />}>
      {(detail) => (
        <LinearIssueView
          issue={detail()}
          activeTab={activeTab()}
          refreshing={refreshing()}
          refreshError={refreshError()}
          posting={posting()}
          postError={postError()}
          backTo={override() ? target()?.identifier : undefined}
          onSelect={setActiveTab}
          onRefresh={() => void refresh()}
          onBack={() => {
            const current = target()
            if (current) open(current)
          }}
          onOpenRelated={openRelated}
          onLink={onLink}
          onComment={(text, parentId) => void comment(text, parentId)}
          onCopy={(text) => void copy(text)}
        />
      )}
    </Show>
  )

  // The ticket switcher for a task linking several is the list column, an app-shell concern rather
  // than the view's. The ref-panel contract's multi-ref chip strip does not cross the bridge, so a
  // multi-ticket task gets its switcher here.
  return (
    <Show when={linked().length > 1} fallback={body()}>
      <ListDetail split listWidth="narrow">
        <ListColumn label="Linked Linear issues">
          <For each={linked()}>
            {(entry) => (
              <Row
                density="compact"
                selected={target() ? targetKey(target()!) === targetKey(entry) : false}
                onPress={() => open(entry)}
                meta={titles()[entry.identifier] ? entry.identifier : undefined}
                tip={titles()[entry.identifier]}
              >
                {titles()[entry.identifier] ?? entry.identifier}
              </Row>
            )}
          </For>
        </ListColumn>
        <DetailColumn scroll>{body()}</DetailColumn>
      </ListDetail>
    </Show>
  )
}

// `Show`s, not a bare ternary, for the reason rollbar/src/tree/app.tsx gives: a component body runs
// once, so a ternary there never switches to the error branch after the loading state has drawn.
//
// Loading is the start-aligned busy line; nothing to show and a failure are the centred state a detail
// column uses. A failure is a titled state rather than a banner, the way github's list draws one, so it
// has room for the reason and **Try again**, and it never sits flush against the bar above.
function PageStatus(props: { state: Page }) {
  const failure = () => (props.state.kind === 'error' ? props.state : undefined)
  const empty = () => (props.state.kind === 'empty' ? props.state : undefined)
  return (
    <Show when={failure()} fallback={(
      <Show when={empty()} fallback={<EmptyState busy align="start" size="sm">Loading issue…</EmptyState>}>
        {(state) => <EmptyState title={state().title} />}
      </Show>
    )}
    >
      {(error) => (
        <EmptyState title={error().title}>
          {error().detail}
          {/* A child, not `action`: a tree's props are JSON, so an element-valued prop never arrives. */}
          <Show when={error().retry}>{(retry) => <> <Button size="sm" variant="ghost" onPress={retry()}>Try again</Button></>}</Show>
        </EmptyState>
      )}
    </Show>
  )
}
