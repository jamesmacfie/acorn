import { createMemo, createSignal, For, Show } from 'solid-js'
import { Card, EmptyState, StatusDot } from '../../../kit/components/primitives'
import { PANEL_SOURCE_FIELD_ID } from '../mapping'
import { boardColumns, groupField, titleField } from '../shaping'
import Cell from './Cell'
import Provenance from './Provenance'
import { panelDotTone, rowPress, type PanelViewProps } from './props'
import RowControls from './RowControls'

// The board view. Kanban is not a component, it is group-by over a field with finite values
// (docs/dashboards/views.md § Views are derived, not chosen from a menu), so there is almost nothing here.
// The columns come out of `boardColumns`, the order within a column is whatever the panel's sort
// already produced, and the rows are whatever its filters already kept. There is no per-column sort
// and no per-column filter in this file because there is nothing left for them to do.
//
// Cards draw their fields with the same `Cell` the list and the table use. A second rendering path
// for "a field, on a card" is how a datetime ends up as an age in one view and a raw number in
// another.

export default function BoardView(props: PanelViewProps) {
  const [dragged, setDragged] = createSignal<string>()
  const [refusal, setRefusal] = createSignal<string>()
  const field = createMemo(() => groupField(props.schema, { groupBy: props.groupBy }))
  const lead = () => titleField(props.schema)
  // The grouped field is the column heading, so repeating it on every card in that column says
  // nothing. Same argument as the list view leaving its lead field out of the meta strip, and the
  // same one for `source`, whose slot on a card is the provenance badge.
  const meta = () => props.fields.filter((entry) =>
    entry.id !== lead()?.id
    && entry.id !== field()?.id
    && !(props.provenance && entry.id === PANEL_SOURCE_FIELD_ID))
  // Memoized so a refresh that changes nothing does not hand `<For>` a whole new set of columns.
  // It keys by reference, and a rebuilt column is a rebuilt column of cards.
  const columns = createMemo(() => {
    const grouped = field()
    return grouped ? boardColumns(props.rows, grouped) : []
  })

  return (
    <Show
      when={field()}
      fallback={<EmptyState align="start" size="sm" title="Can't make a board from this source">It has no status or category field to make columns from.</EmptyState>}
    >
      <div class="dash-board">
        <For each={columns()}>
          {(column) => (
            <section class="dash-board-column" onDragOver={event => {
              if (!dragged()) return
              event.preventDefault()
              const row = props.rows.find(item => item.id === dragged())
              setRefusal(row ? props.boardMoveReason?.(row, column.id) : undefined)
            }} onDrop={event => {
              event.preventDefault()
              const row = props.rows.find(item => item.id === dragged())
              setDragged(undefined)
              setRefusal(undefined)
              if (row) props.onBoardMove?.(row, column.id)
            }}>
              <header class="dash-board-column-head">
                <StatusDot tone={panelDotTone(column.tone)} />
                <span class="dash-board-column-label">{column.label}</span>
                <span class="dash-board-column-count">{column.rows.length}</span>
              </header>
              <Show when={dragged() && refusal()}><span class="dash-board-refusal" role="status">{refusal()}</span></Show>
              {/* Each column scrolls on its own: one long column must not push the others off the
                  bottom of the panel, and the board scrolls sideways rather than the surface. */}
              <div class="dash-board-cards">
                <For each={column.rows} fallback={<span class="dash-board-empty">—</span>}>
                  {(row) => {
                    let pressedControl = false
                    return <div draggable={!!props.onBoardMove} class="dash-board-card" onPointerDown={event => {
                      pressedControl = !!(event.target as HTMLElement).closest('.dash-row-controls, a, input, textarea, select')
                    }} onDragStart={event => {
                      if (pressedControl) { event.preventDefault(); return }
                      setDragged(row.id)
                      event.dataTransfer?.setData('text/plain', row.id)
                    }} onDragEnd={() => { setDragged(undefined); setRefusal(undefined) }}>
                    <Card
                      pad="sm"
                      {...(rowPress(props, row) ? { onPress: rowPress(props, row) } : {})}
                    >
                      <span class="dash-card-title">
                        <Show when={props.provenance}><Provenance pluginId={row.pluginId} /></Show>
                        <Show when={lead()} fallback={row.id}>
                          {(entry) => <Cell field={entry()} value={row.values[entry().id]} />}
                        </Show>
                      </span>
                      <Show when={meta().length}>
                        <span class="dash-card-meta">
                          <For each={meta()}>
                            {(entry) => <span><Cell field={entry} value={row.values[entry.id]} /></span>}
                          </For>
                        </span>
                      </Show>
                    </Card>
                    <Show when={props.onBoardMove}><RowControls panelId={props.panelId} row={row} buttons={props.buttons}
                      onButton={props.onButton} onOpenRecord={props.onOpenRecord} boardChoices={props.boardChoices}
                      boardMoveReason={props.boardMoveReason} onBoardMove={props.onBoardMove} /></Show>
                    </div>
                  }}
                </For>
              </div>
            </section>
          )}
        </For>
      </div>
    </Show>
  )
}
