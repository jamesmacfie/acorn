import { createMemo, Show, splitProps, type JSX } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import type { DashboardDisplayRow } from '@acorn/dashboards-core/render'
import { displayPlanGroups, displayPlanRun, type DashboardRun } from '@acorn/dashboards-core/plan.ts'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import { Alert, Button, EmptyState } from '../../kit/components/primitives'
import { Text } from '../../kit/components/content/Text'
import { groupField } from './shaping'
import SuppliedOrigin from './SuppliedOrigin'
import PanelBody from './views/PanelBody'
import type { PanelViewProps } from './views/props'
import './dashboards.css'

/** The panel's ID and the presses a client handles, passed through to the views. A press left out is
 *  off. */
const HANDLERS = [
  'panelId',
  'onActivate',
  'canActivate',
  'onButton',
  'onOpenRecord',
  'onDrilldown',
  'onMeasureDrilldown',
  'onCorrect',
  'boardMoveReason',
  'onBoardMove',
] as const
type RunPanelHandlers = Pick<PanelViewProps, (typeof HANDLERS)[number]>

/** One run of a panel's plan, drawn from props alone, so a client with no router, query client, or
 *  Node connection can draw it. The client runs the plan, picks which answer to show, and handles
 *  presses. This component draws where supplied rows came from, the run's notes, the panel, and its
 *  loading and failed states. */
export default function RunPanel(
  props: RunPanelHandlers & {
    /** The plan the run answers. Where its supplied rows came from shows before the first answer. */
    plan: PanelPlan | undefined
    /** The answer to draw. Absent until the first one arrives. */
    run: DashboardRun | undefined
    /** Draws the answer greyed out and inert, because a newer one has a source that couldn't answer. */
    stale?: boolean
    /** Says what the run shows, for a plan nobody has read in the studio. */
    describe?: boolean
    /** The last read failed. With no answer to draw, the panel says it couldn't load. */
    error?: boolean
    onRetry?: () => void
    /** The latest answer's problems, already described by the client. */
    problems?: JSX.Element
    /** The client's own notices and confirms, drawn after the run's notes and before the panel. */
    children?: JSX.Element
  },
) {
  const [handlers] = splitProps(props, HANDLERS)
  const supplied = () => {
    const reference = props.plan?.sources[0]?.reference
    return reference?.kind === 'supplied' ? reference : undefined
  }
  // A refetch hands back new row objects. Reconciled by id into one store array, a row that came
  // back keeps its object, so its cells update where they are and the view doesn't mount it again. The
  // rows go to the views as the store itself, because a view reads `props.rows` where it picks table or
  // sections, and a new object there redraws the lot.
  const [rows, setRows] = createStore<DashboardDisplayRow[]>([])
  const display = createMemo(() => {
    if (!props.run) return undefined
    const shown = displayPlanRun(props.run.plan, props.run.rows)
    setRows(reconcile(shown.rows, { key: 'id' }))
    return { schema: shown.schema, fields: shown.fields }
  })

  return (
    <>
      <Show when={supplied()}>{(reference) => <SuppliedOrigin origin={reference().origin} />}</Show>
      <Show
        when={!props.error || props.run}
        fallback={
          <EmptyState
            align="start"
            size="sm"
            title="Couldn't load this panel"
            action={
              <Show when={props.onRetry}>
                {(retry) => (
                  <Button size="sm" onPress={() => retry()()}>
                    Try again
                  </Button>
                )}
              </Show>
            }
          >
            Edit the panel to repair its source or column.
          </EmptyState>
        }
      >
        <Show when={props.error && props.run}>
          <Alert tone="warn">Couldn't refresh. Showing the last data we got.</Alert>
        </Show>
        {props.problems}
        <Show when={props.run?.diagnostics.asOf}>
          {(time) => <span>{`As of ${new Date(time()).toLocaleString()}`}</span>}
        </Show>
        <Show when={props.run?.diagnostics.sources.some((source) => source.coverageWindows?.length)}>
          <Alert tone="muted">
            {props
              .run!.diagnostics.sources.flatMap((source) =>
                (source.coverageWindows ?? [])
                  .slice(0, 3)
                  .map(
                    (window) =>
                      `${source.label}: ${window.kind === 'complete' ? 'events covered' : 'coverage gap'} ${new Date(window.fromTime).toLocaleDateString()}–${new Date(window.toTime).toLocaleDateString()}${window.reason ? ` (${window.reason})` : ''}`,
                  ),
              )
              .join(' · ')}
          </Alert>
        </Show>
        <Show when={props.run?.rows.some((row) => row.partial && Object.keys(row.partial).length)}>
          <Alert tone="warn">
            {[...new Set(props.run!.rows.flatMap((row) => Object.values(row.partial ?? {})))].join(' ')} Measures marked
            partial may leave out unknown values.
          </Alert>
        </Show>
        {props.children}
        <Show when={props.describe && props.run?.description.length ? props.run.description : undefined}>
          {(lines) => (
            <Text tone="muted" wrap>
              {lines().join(' ')}
            </Text>
          )}
        </Show>
        <Show
          when={display()}
          fallback={
            <EmptyState align="start" size="sm" busy>
              Loading…
            </EmptyState>
          }
        >
          {(value) => {
            const plan = () => props.run!.plan
            return (
              <div class="dash-panel-data" data-stale={props.stale ? '' : undefined} inert={props.stale}>
                <PanelBody
                  {...handlers}
                  view={plan().view}
                  schema={value().schema}
                  fields={value().fields}
                  rows={rows}
                  groups={displayPlanGroups(props.run!.groups, rows)}
                  groupBy={plan().group?.[0]?.column}
                  provenance={plan().sources.length > 1}
                  pressConfigured={!!plan().actions?.press}
                  buttons={plan().actions?.buttons ?? []}
                  boardChoices={
                    plan().columns.find(
                      (column) => column.id === groupField(value().schema, { groupBy: plan().group?.[0]?.column })?.id,
                    )?.choices ?? []
                  }
                />
              </div>
            )
          }}
        </Show>
      </Show>
    </>
  )
}
