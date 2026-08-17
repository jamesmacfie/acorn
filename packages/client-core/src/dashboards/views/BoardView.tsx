import { createMemo, For, Show } from 'solid-js'
import { Card, EmptyState, StatusDot } from '../../ui/primitives'
import { PANEL_SOURCE_FIELD_ID } from '../mapping'
import { boardColumns, groupField, titleField } from '../shaping'
import Cell from './Cell'
import Provenance from './Provenance'
import type { PanelViewProps } from './props'

// The board view — and there is deliberately almost nothing here, because A KANBAN IS NOT A
// COMPONENT: it is group-by over a field with finite values (docs/dashboards.md § Views are
// derived, not chosen from a menu). The columns come out of `boardColumns`, the order within a
// column is whatever the panel's
// sort already produced, and the rows are whatever its filters already kept. There is no per-column
// sort and no per-column filter in this file because there is nothing left for them to do.
//
// Cards draw their fields with the same `Cell` the list and the table use. A second rendering path
// for "a field, on a card" is how a datetime ends up as an age in one view and a raw number in
// another.

export default function BoardView(props: PanelViewProps) {
  const field = createMemo(() => groupField(props.schema, { groupBy: props.groupBy }))
  const lead = () => titleField(props.schema)
  // The grouped field is the column heading, so repeating it on every card in that column says
  // nothing. Same argument as the list view leaving its lead field out of the meta strip — and the
  // same one for `source`, whose slot on a card is the provenance badge.
  const meta = () => props.fields.filter((entry) =>
    entry.id !== lead()?.id
    && entry.id !== field()?.id
    && !(props.provenance && entry.id === PANEL_SOURCE_FIELD_ID))
  // Memoized so a refresh that changes nothing does not hand `<For>` a whole new set of columns —
  // it keys by reference, and a rebuilt column is a rebuilt column of cards.
  const columns = createMemo(() => {
    const grouped = field()
    return grouped ? boardColumns(props.rows, grouped) : []
  })

  return (
    <Show
      when={field()}
      fallback={<EmptyState align="start" size="sm" title="Nothing to group by">This collection declares no field with a fixed set of values.</EmptyState>}
    >
      <div class="dash-board">
        <For each={columns()}>
          {(column) => (
            <section class="dash-board-column">
              <header class="dash-board-column-head">
                <StatusDot tone={column.tone} />
                <span class="dash-board-column-label">{column.label}</span>
                <span class="dash-board-column-count">{column.rows.length}</span>
              </header>
              {/* Each column scrolls on its own: one long column must not push the others off the
                  bottom of the panel, and the board scrolls sideways rather than the surface. */}
              <div class="dash-board-cards">
                <For each={column.rows} fallback={<span class="dash-board-empty">—</span>}>
                  {(row) => (
                    <Card
                      pad="sm"
                      class="dash-card"
                      {...(row.action ? { onActivate: () => props.onActivate(row) } : {})}
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
                  )}
                </For>
              </div>
            </section>
          )}
        </For>
      </div>
    </Show>
  )
}
