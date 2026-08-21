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

/** Frame authoring and the UI kit (docs/plugins.md) covers why the bridge is the frame's only data and I/O seam. */
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
      {/* The mark inlined, not an <Icon name="brand:rollbar" />: this frame is a separate origin and a
          separate JS realm, so the host's brand-mark registry is not reachable from here. Same path
          data as the manifest's `icon`, and `currentColor` still lets .rb-brand-mark colour it. */}
        <span class="rb-brand-mark">
          <svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M24 2.5795c-.0019-.1956-.1152-.5064-.484-.584-.0578-.0162-.1178-.0113-.177-.0104-.3082.0276-4.3793.4162-8.9551 2.4569-2.7478 1.2221-4.8747 3.0984-6.213 5.376l-.3449.1494C2.9271 12.1542 0 16.4046 0 21.338v.0828c0 .3392.2786.5955.5967.5955h16.2625c.1045 0 .2506-.0351.3748-.1391l6.5533-5.5255a.5932.5932 0 0 0 .2116-.4598V2.5795Zm-6.5544 17.5582V8.382l5.3622-4.5195v11.7557ZM7.3684 16.4908h8.885v4.3333H2.227ZM14.868 5.532a30.7234 30.7234 0 0 1 6.5315-2.043L16.6063 7.53a30.4061 30.4061 0 0 0-6.489 1.528c1.1866-1.4487 2.787-2.6501 4.7506-3.5262ZM8.978 10.7722a30.7706 30.7706 0 0 1 7.2753-1.9947v6.5211h-8.494a10.5382 10.5382 0 0 1 1.2187-4.5264zm-1.636.7611a11.8074 11.8074 0 0 0-.7887 4.0826l-5.2886 4.4632c.4-3.6262 2.5535-6.6591 6.0773-8.5458z" />
          </svg>
        </span>
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

// PageStatus only maps PageState to a primitive class now. `.rb-placeholder` and `.rb-error` were
// this frame's private copies of two shared components; primitives.css already ships to plugin
// frames, so referencing it skips redeclaring the rule.
function PageStatus(props: { state: PageState }) {
  return props.state.kind === 'error'
    ? <Alert variant="banner" title={props.state.title}>{props.state.detail}</Alert>
    : <EmptyState busy={props.state.kind === 'loading'}>{props.state.message}</EmptyState>
}
