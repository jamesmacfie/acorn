import { createMemo, createSignal, onCleanup, Show } from 'solid-js'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import { displayPlanGroups, displayPlanRun, type DashboardRun } from '@acorn/dashboards-core/plan.ts'
import type { PlanPartKey } from '@acorn/dashboards-core/outline.ts'
import { formatRelativeTime } from '@acorn/dashboards-core/relativeTime.ts'
import { Button, Card, EmptyState, SegmentedControl } from '../../../kit/components/primitives'
import { Heading } from '../../../kit/components/content/Heading'
import { Text } from '../../../kit/components/content/Text'
import { IconButton } from '../../../kit/components/inputs/IconButton'
import { Inline } from '../../../kit/components/layout/Inline'
import { COLS, sizePresets, type Rect } from '../layout'
import PanelBody from '../views/PanelBody'

// The studio's live preview: the panel's own body, in the card a placed panel uses, at the width and
// height it would have on the dashboard (docs/dashboards/mapping-and-editor.md § The generated editor).
// While an AI proposal is under review, it switches between the plan as it is and as proposed.

type Size = 's' | 'm' | 'l'
export type PreviewSide = 'before' | 'after'
const rowCount = (count: number) => `${count} ${count === 1 ? 'row' : 'rows'}`

/** The preset whose width is closest to where the panel is placed, or medium for a new panel. */
const closestSize = (kind: string, placed: Rect | undefined): Size => {
  if (!placed) return 'm'
  const presets = sizePresets(kind)
  return (['s', 'm', 'l'] as const).reduce((best, size) => Math.abs(presets[size].w - placed.w) < Math.abs(presets[best].w - placed.w) ? size : best)
}

export default function StudioPreview(props: {
  plan: PanelPlan
  run?: DashboardRun
  loading: boolean
  /** Where the panel is placed now, when it is. */
  placed?: Rect
  onRefresh: () => void
  onSelectPart: (key: PlanPartKey) => void
  onEditTitle: () => void
  /** Set while a proposal is under review. `plan` and `run` are the side showing, and `beforeRows` is
   *  the current plan's row count, for "17 rows (was 41)". */
  review?: { showing: PreviewSide; onShow: (side: PreviewSide) => void; beforeRows?: number }
}) {
  const [size, setSize] = createSignal<Size>(closestSize(props.plan.view.kind, props.placed))
  // The cell is a twelfth of the preview area, as a cell is a twelfth of the grid. The grid's gaps
  // aren't counted, so a wide panel previews a little larger than it places.
  const [cell, setCell] = createSignal(0)
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(([entry]) => setCell((entry?.contentRect.width ?? 0) / COLS))
  onCleanup(() => observer?.disconnect())
  const rect = () => sizePresets(props.plan.view.kind)[size()]
  const display = createMemo(() => props.run ? displayPlanRun(props.run.plan, props.run.rows) : undefined)

  return (
    <div class="dash-studio-preview">
      <Inline gap="inline" wrap>
        <Text emphasis="muted">Size on the dashboard</Text>
        <SegmentedControl ariaLabel="Size on the dashboard" size="sm" value={size()} onChange={setSize}
          options={[{ value: 's', label: 'S', title: 'Small' }, { value: 'm', label: 'M', title: 'Medium' }, { value: 'l', label: 'L', title: 'Large' }]} />
        <Show when={props.review}>{review => <SegmentedControl ariaLabel="Compare with the proposal" size="sm" value={review().showing} onChange={review().onShow}
          options={[{ value: 'before', label: 'Before' }, { value: 'after', label: 'After' }]} />}</Show>
        <Show when={props.run}>{run => <Text emphasis="muted">
          {`${rowCount(run().rows.length)}${props.review?.showing === 'after' && props.review.beforeRows !== undefined ? ` (was ${props.review.beforeRows})` : ''} · read ${formatRelativeTime(run().diagnostics.evaluationTime)}`}
        </Text>}</Show>
        <IconButton icon="refresh-cw" label="Read the data again" size="sm" spin={props.loading} disabled={props.loading} onPress={props.onRefresh} />
      </Inline>
      <div class="dash-studio-stage" ref={element => observer?.observe(element)}>
        <div class="dash-studio-frame" style={cell() ? { width: `${rect().w * cell()}px`, height: `${rect().h * cell()}px` } : {}}>
          <Card>
            <div class="dash-panel-head"><Heading level={3}><Button variant="bare" onPress={props.onEditTitle}>{props.plan.title}</Button></Heading></div>
            <div class="dash-panel-body">
              <Show when={display()} fallback={<EmptyState align="start" size="sm" busy={props.loading} title="No preview yet">Finish the parts marked with a problem to see rows.</EmptyState>}>
                {value => <PanelBody view={props.plan.view} schema={value().schema} fields={value().fields} rows={value().rows}
                  groups={displayPlanGroups(props.run!.groups, value().rows)} {...(props.plan.group?.[0] ? { groupBy: props.plan.group[0].column } : {})}
                  provenance={props.plan.sources.length > 1} onSelectPart={props.onSelectPart} />}
              </Show>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
