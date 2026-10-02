import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import {
  Button, DetailColumn, EmptyState, ListColumn, ListDetail, Row,
} from '@acorn/plugin-api/ui/tree'
import type { AcornBridge } from '@acorn/plugin-api/ui/sdk'
import type { Task } from '@acorn/protocol/api.ts'
import {
  rollbarItemMetadataRoute,
  rollbarOccurrenceRoute,
  rollbarOccurrencesRoute,
  type RollbarItemMetadata,
  type RollbarOccurrenceDetail,
  type RollbarOccurrenceSummary,
} from '../shared/api'
import { parseRollbarRailItemId, type RollbarRailTarget } from '../shared/rail'
import { failureReason, occurrenceContext, targetKey, taskRollbarTargets } from './model'
import { RollbarItemView, type OccurrenceState, type RollbarViewState } from './RollbarItemView'

type PageState =
  | { kind: 'empty'; title: string }
  | { kind: 'loading' }
  | { kind: 'error'; title: string; detail: string; retry?: () => void }

/** What the host mounts this tree with: the pane's subject, minted by the shell per slot. */
export type RollbarPaneProps = { taskId?: string; item?: string }

/**
 * The Rollbar pane, as a tree.
 *
 * The bridge is still this plugin's only data and I/O seam, exactly as it was in the frame. What
 * changed is the other direction: the pane's own brand header is gone, because the pane switcher
 * already draws the name and the mark, and an iframe drew its own only because it had no chrome to
 * borrow.
 */
export function RollbarPane(props: RollbarPaneProps & { bridge: AcornBridge }) {
  const [linkedTargets, setLinkedTargets] = createSignal<RollbarRailTarget[]>([])
  const [view, setView] = createSignal<RollbarViewState | null>(null)
  const [page, setPage] = createSignal<PageState>({ kind: 'loading' })
  const [activeTab, setActiveTab] = createSignal('overview')
  const [occurrence, setOccurrence] = createSignal<OccurrenceState>({ kind: 'empty' })
  // The newest occurrence, for Overview: the message and stack are why anyone opens an error.
  const [latest, setLatest] = createSignal<OccurrenceState>({ kind: 'empty' })
  const [refreshing, setRefreshing] = createSignal(false)
  const [refreshError, setRefreshError] = createSignal('')
  let itemLoad = 0
  let occurrenceLoad = 0

  const load = async (target: RollbarRailTarget, refresh = false): Promise<void> => {
    if (refresh && refreshing()) return
    const request = ++itemLoad
    const keepView = refresh && view() !== null && targetKey(view()!.target) === targetKey(target)
    setRefreshError('')
    if (keepView) setRefreshing(true)
    else {
      occurrenceLoad += 1
      setRefreshing(false)
      setView(null)
      setOccurrence({ kind: 'empty' })
      setLatest({ kind: 'empty' })
      setActiveTab('overview')
      setPage({ kind: 'loading' })
    }
    try {
      const [item, occurrences] = await Promise.all([
        props.bridge.api.get<RollbarItemMetadata>(
          rollbarItemMetadataRoute(target.integrationId, target.identifier, refresh),
        ),
        props.bridge.api.get<{ occurrences: RollbarOccurrenceSummary[] }>(
          rollbarOccurrencesRoute(target.integrationId, target.identifier, refresh),
        ),
      ])
      if (request !== itemLoad) return
      const currentOccurrence = occurrence()
      if (!keepView || currentOccurrence.kind !== 'ready' || !occurrences.occurrences.some((entry) => entry.id === currentOccurrence.detail.id)) {
        setOccurrence({ kind: 'empty' })
      }
      setView({ target, item, occurrences: occurrences.occurrences })
      const newest = occurrences.occurrences[0]
      if (newest) void loadLatest(target, newest.id, request, keepView)
      else setLatest({ kind: 'empty' })
    } catch (error) {
      if (request !== itemLoad) return
      if (keepView) setRefreshError(failureReason(error))
      else setPage({ kind: 'error', title: "Couldn't load this error", detail: failureReason(error), retry: () => void load(target) })
    } finally {
      if (request === itemLoad) setRefreshing(false)
    }
  }

  // The same cached occurrence route the Occurrences tab reads, so Overview adds no new request shape.
  // A refresh keeps the old one on screen until the new one lands.
  const loadLatest = async (target: RollbarRailTarget, id: string, request: number, keep: boolean): Promise<void> => {
    if (!keep) setLatest({ kind: 'loading', id })
    try {
      const detail = await props.bridge.api.get<RollbarOccurrenceDetail>(
        rollbarOccurrenceRoute(target.integrationId, target.identifier, id),
      )
      if (request === itemLoad) setLatest({ kind: 'ready', detail })
    } catch (error) {
      if (request === itemLoad && !keep) setLatest({ kind: 'error', id, detail: failureReason(error) })
    }
  }

  const loadOccurrence = async (id: string): Promise<void> => {
    const current = view()
    if (!current) return
    const request = ++occurrenceLoad
    setOccurrence({ kind: 'loading', id })
    try {
      const detail = await props.bridge.api.get<RollbarOccurrenceDetail>(
        rollbarOccurrenceRoute(current.target.integrationId, current.target.identifier, id),
      )
      if (request === occurrenceLoad && view() === current) setOccurrence({ kind: 'ready', detail })
    } catch (error) {
      if (request === occurrenceLoad && view() === current) {
        setOccurrence({ kind: 'error', id, detail: failureReason(error) })
      }
    }
  }

  const copyOccurrence = async (detail: RollbarOccurrenceDetail): Promise<void> => {
    const current = view()
    if (!current) return
    await props.bridge.ui.copy(occurrenceContext(current.item, detail))
    props.bridge.ui.toast('Copied the error details')
  }

  onMount(() => {
    const off = props.bridge.onSelect((item) => {
      const target = parseRollbarRailItemId(item)
      if (target) void load(target)
    })
    onCleanup(off)

    void (async () => {
      // The subject comes from the mount props, not from `bridge.context`: one worker serves every
      // tree this bundle draws and therefore holds one bridge, so the context is the bundle's and the
      // props are this slot's (docs/plugin-authoring.md § The client half).
      const selected = props.item ? parseRollbarRailItemId(props.item) : null
      if (selected) return load(selected)

      const taskId = props.taskId
      if (!taskId) {
        setPage({ kind: 'empty', title: 'Choose an error' })
        return
      }

      try {
        const tasks = await props.bridge.api.get<Task[]>('/v1/core/tasks')
        const targets = taskRollbarTargets(tasks.find((task) => task.id === taskId))
        setLinkedTargets(targets)
        const first = targets[0]
        if (first) await load(first)
        else setPage({ kind: 'empty', title: 'This task has no Rollbar errors' })
      } catch (error) {
        setPage({ kind: 'error', title: "Couldn't load this task", detail: failureReason(error) })
      }
    })()
  })

  const body = () => (
    <Show when={view()} fallback={<PageStatus state={page()} />}>
      {(state) => (
        <RollbarItemView
          state={state()}
          activeTab={activeTab()}
          occurrence={occurrence()}
          latest={latest()}
          refreshing={refreshing()}
          refreshError={refreshError()}
          onSelect={setActiveTab}
          onRefresh={() => void load(state().target, true)}
          onOccurrence={(id) => void loadOccurrence(id)}
          onCopy={(detail) => void copyOccurrence(detail)}
        />
      )}
    </Show>
  )

  // `split` with two column nodes rather than ListDetail's `list` prop: a tree's props are JSON on a
  // message port, so an element cannot be one of them (docs/plugins.md § The tree contract). The
  // column only appears when there is more than one linked item, as it did before.
  return (
    <Show when={linkedTargets().length > 1} fallback={body()}>
      <ListDetail split listWidth="narrow">
        <ListColumn label="Linked Rollbar errors">
          <For each={linkedTargets()}>{(target) => (
            <Row
              density="compact"
              selected={view() ? targetKey(view()!.target) === targetKey(target) : false}
              onPress={() => void load(target)}
            >
              #{target.identifier}
            </Row>
          )}</For>
        </ListColumn>
        <DetailColumn scroll>{body()}</DetailColumn>
      </ListDetail>
    </Show>
  )
}

// `Show`s, not a bare ternary. A component body runs once, so a ternary there stays on whichever
// branch the first state picked: the pane mounts loading, the fetch fails, and the error had nowhere
// to draw. What was left was the EmptyState with its text removed, which reads as a blank pane.
//
// Loading is the start-aligned busy line; nothing to show and a failure are the centred state a detail
// column uses, the failure with its reason and **Try again** (linear/src/tree/app.tsx says why).
function PageStatus(props: { state: PageState }) {
  const failure = () => (props.state.kind === 'error' ? props.state : undefined)
  const empty = () => (props.state.kind === 'empty' ? props.state : undefined)
  return (
    <Show when={failure()} fallback={(
      <Show when={empty()} fallback={<EmptyState busy align="start" size="sm">Loading…</EmptyState>}>
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
