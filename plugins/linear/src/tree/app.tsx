import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { Alert, DetailColumn, EmptyState, ListColumn, ListDetail, Row } from '@acorn/plugin-api/ui/tree'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import type { Task } from '@acorn/protocol/api.ts'
import {
  linearCommentsRoute,
  linearIssueRoute,
  type LinearIssueDetail,
} from '../shared/api'
import { parseLinearRailItemId, type LinearRailTarget } from '../shared/rail'
import { canonicalIdentifier, linearIdentifierFromHref, targetKey, taskLinearTargets } from './model'
import { LinearIssueView } from './LinearIssueView'

// One renderer, three manifest surfaces, told apart by what the host mounted this slot with
// (docs/integrations.md § Linear).
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
  | { kind: 'empty'; message: string }
  | { kind: 'loading' }
  | { kind: 'error'; title: string; detail: string }

const detailOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

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
  const [posting, setPosting] = createSignal(false)
  const [postError, setPostError] = createSignal('')
  let load = 0

  const activeIdentifier = () => override() ?? target()?.identifier ?? ''

  const fetchIssue = async (identifier: string, connectionId?: string): Promise<void> => {
    const request = ++load
    setPage({ kind: 'loading' })
    try {
      const detail = await props.bridge.api.get<LinearIssueDetail>(linearIssueRoute(identifier, connectionId))
      if (request !== load) return
      setIssue(detail)
    } catch (error) {
      if (request !== load) return
      setIssue(null)
      setPage({ kind: 'error', title: 'Could not load this Linear ticket.', detail: detailOf(error) })
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

  // A linear.app ticket link stays local rather than going through the host (docs/integrations.md §
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
      await fetchIssue(activeIdentifier(), target()?.connectionId)
    } finally {
      setRefreshing(false)
    }
  }

  const comment = async (body: string, parentId?: string): Promise<void> => {
    setPosting(true)
    setPostError('')
    try {
      await props.bridge.api.post(linearCommentsRoute(activeIdentifier(), target()?.connectionId), { body, parentId })
      await fetchIssue(activeIdentifier(), target()?.connectionId)
    } catch (error) {
      setPostError(detailOf(error) || 'Failed to add comment.')
    } finally {
      setPosting(false)
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
        return setPage({ kind: 'empty', message: 'Pick an issue from the list.' })
      }
      try {
        const tasks = await props.bridge.api.get<Task[]>('/v2/core/tasks')
        const targets = taskLinearTargets(tasks.find((task) => task.id === props.taskId))
        setLinked(targets)
        const first = targets[0]
        if (first) return open(first)
        setPage({
          kind: 'empty',
          message: 'No Linear issues are linked to this task. Pick one from the Linear rail, then choose Create task from its row menu.',
        })
      } catch (error) {
        setPage({ kind: 'error', title: 'Could not read this task.', detail: detailOf(error) })
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
          posting={posting()}
          postError={postError()}
          overridden={!!override()}
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
              >
                {entry.identifier}
              </Row>
            )}
          </For>
        </ListColumn>
        <DetailColumn scroll>{body()}</DetailColumn>
      </ListDetail>
    </Show>
  )
}

function PageStatus(props: { state: Page }) {
  return props.state.kind === 'error'
    ? (
      <Alert variant="banner" title={props.state.title}>{props.state.detail}</Alert>
    )
    : (
      <EmptyState busy={props.state.kind === 'loading'}>
        {props.state.kind === 'loading' ? 'Loading Linear…' : props.state.kind === 'empty' ? props.state.message : ''}
      </EmptyState>
    )
}
