import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import {
  Alert, DetailColumn, EmptyState, ListColumn, ListDetail, Row,
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
import { occurrenceContext, targetKey, taskRollbarTargets } from './model'
import { RollbarItemView, type OccurrenceState, type RollbarViewState } from './RollbarItemView'

type PageState =
  | { kind: 'empty'; message: string }
  | { kind: 'loading'; message: string }
  | { kind: 'error'; title: string; detail: string }

const detailOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

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
  const [page, setPage] = createSignal<PageState>({ kind: 'loading', message: 'Loading Rollbar…' })
  const [activeTab, setActiveTab] = createSignal('overview')
  const [occurrence, setOccurrence] = createSignal<OccurrenceState>({ kind: 'empty' })
  let itemLoad = 0
  let occurrenceLoad = 0

  const load = async (target: RollbarRailTarget, refresh = false): Promise<void> => {
    const request = ++itemLoad
    occurrenceLoad += 1
    setView(null)
    setOccurrence({ kind: 'empty' })
    setActiveTab('overview')
    setPage({ kind: 'loading', message: 'Loading Rollbar item…' })
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
      setView({ target, item, occurrences: occurrences.occurrences })
    } catch (error) {
      if (request !== itemLoad) return
      setPage({ kind: 'error', title: 'Could not load this Rollbar item.', detail: detailOf(error) })
    }
  }

  const loadOccurrence = async (id: string): Promise<void> => {
    const current = view()
    if (!current) return
    const request = ++occurrenceLoad
    setOccurrence({ kind: 'loading' })
    try {
      const detail = await props.bridge.api.get<RollbarOccurrenceDetail>(
        rollbarOccurrenceRoute(current.target.integrationId, current.target.identifier, id),
      )
      if (request === occurrenceLoad && view() === current) setOccurrence({ kind: 'ready', detail })
    } catch (error) {
      if (request === occurrenceLoad && view() === current) {
        setOccurrence({ kind: 'error', detail: detailOf(error) })
      }
    }
  }

  const copyOccurrence = async (detail: RollbarOccurrenceDetail): Promise<void> => {
    const current = view()
    if (!current) return
    await props.bridge.ui.copy(occurrenceContext(current.item, detail))
    props.bridge.ui.toast('Rollbar context copied')
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
        setPage({ kind: 'empty', message: 'Open a task or select an item from the Rollbar rail.' })
        return
      }

      try {
        const tasks = await props.bridge.api.get<Task[]>('/v2/core/tasks')
        const targets = taskRollbarTargets(tasks.find((task) => task.id === taskId))
        setLinkedTargets(targets)
        const first = targets[0]
        if (first) await load(first)
        else {
          setPage({
            kind: 'empty',
            message: 'No Rollbar items are linked to this task. Select one from the Rollbar rail, then choose Create task from its row menu.',
          })
        }
      } catch (error) {
        setPage({ kind: 'error', title: 'Could not read this task.', detail: detailOf(error) })
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
          onSelect={setActiveTab}
          onRefresh={() => void load(state().target, true)}
          onOccurrence={(id) => void loadOccurrence(id)}
          onCopy={(detail) => void copyOccurrence(detail)}
        />
      )}
    </Show>
  )

  // `split` with two column nodes rather than ListDetail's `list` prop: a tree's props are JSON on a
  // message port, so an element cannot be one of them (docs/future/layout/06-remote-tree.md). The
  // column only appears when there is more than one linked item, as it did before.
  return (
    <Show when={linkedTargets().length > 1} fallback={body()}>
      <ListDetail split listWidth="narrow">
        <ListColumn label="Linked Rollbar items">
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

function PageStatus(props: { state: PageState }) {
  return props.state.kind === 'error'
    ? <Alert variant="banner" title={props.state.title}>{props.state.detail}</Alert>
    : <EmptyState busy={props.state.kind === 'loading'}>{props.state.message}</EmptyState>
}
