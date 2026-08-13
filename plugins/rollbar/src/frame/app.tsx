import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { Alert, EmptyState, ListDetail, Row } from '@acorn/plugin-api/ui'
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

/** Solid owns synchronization inside the isolated frame; the bridge remains the only data/I/O seam. */
export function RollbarFrameApp(props: { bridge: AcornBridge }) {
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
      const selected = props.bridge.context.item
        ? parseRollbarRailItemId(props.bridge.context.item)
        : null
      if (selected) return load(selected)

      const taskId = props.bridge.context.taskId
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
            message: 'No Rollbar items are linked to this task. Select one from the Rollbar rail or use +TASK to attach it.',
          })
        }
      } catch (error) {
        setPage({ kind: 'error', title: 'Could not read this task.', detail: detailOf(error) })
      }
    })()
  })

  return (
    <div class="rb-app">
      <header class="rb-header">
        <span class="rb-brand-mark glyph">◉</span>
        <strong class="rb-brand">Rollbar</strong>
      </header>
      <ListDetail
        listWidth="narrow"
        listLabel="Linked Rollbar items"
        listClass="rb-targets"
        detailClass="rb-content"
        detailAs="main"
        scrollDetail
        list={linkedTargets().length > 1
          ? (
            <For each={linkedTargets()}>{(target) => (
              <Row
                class="rb-target"
                density="compact"
                selected={view() ? targetKey(view()!.target) === targetKey(target) : false}
                onActivate={() => void load(target)}
              >
                #{target.identifier}
              </Row>
            )}</For>
          )
          : undefined}
      >
        <Show when={view()} fallback={<PageStatus state={page()} />}>
          {(state) => (
            <RollbarItemView
              state={state()}
              activeTab={activeTab()}
              occurrence={occurrence()}
              onTab={setActiveTab}
              onRefresh={() => void load(state().target, true)}
              onOccurrence={(id) => void loadOccurrence(id)}
              onCopy={(detail) => void copyOccurrence(detail)}
            />
          )}
        </Show>
      </ListDetail>
    </div>
  )
}

// Kept as the PageState→primitive mapping, but it no longer draws anything: `.rb-placeholder` and
// `.rb-error` were this frame's private spellings of two shared components, and primitives.css is
// already served to plugin frames, so the frame now looks like the shell without re-declaring a rule.
function PageStatus(props: { state: PageState }) {
  return props.state.kind === 'error'
    ? <Alert variant="banner" title={props.state.title}>{props.state.detail}</Alert>
    : <EmptyState busy={props.state.kind === 'loading'}>{props.state.message}</EmptyState>
}
