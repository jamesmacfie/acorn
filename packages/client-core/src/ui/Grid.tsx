import { createEffect, createSignal, For, on, onCleanup } from 'solid-js'
import { createVirtualizer } from '@tanstack/solid-virtual'
import { rowHeightSm } from './metrics'

/* Grid: Table for data that does not fit. Same meaning, virtualised rows, one sticky header.

   Two components rather than one flag, because the geometry is different in kind: Table lets the
   browser size its columns, and a virtualised list cannot — the row height and the column track
   both have to be numbers before a row is drawn. See docs/ui-design.md § The closed kit.

   Cells are strings. A cell that wants a Badge wants a Table.

   At 80×24: as Table, with a row-range indicator. */
export function Grid(props: {
  columns: readonly string[]
  rows: readonly (readonly string[])[]
  /** Index into `rows`. The host owns the selection; this reflects it. */
  selected?: number | null
  onSelectRow?: (index: number) => void
  ariaLabel: string
  /** Re-read the density token when the appearance changes. A frame has no shell signal to watch,
   *  so it passes its bridge's subscribe here. */
  onAppearanceChange?: (listener: () => void) => () => void
}) {
  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement>()
  // Row height comes from --row-h-sm so a style pack's density reaches the grid. The virtualizer
  // writes it back as an inline height, which beats any stylesheet rule.
  const [rowH, setRowH] = createSignal(rowHeightSm())
  const virt = createVirtualizer({
    get count() { return props.rows.length },
    getScrollElement: () => scrollEl() ?? null,
    estimateSize: () => rowH(),
    overscan: 16,
  })
  if (props.onAppearanceChange) {
    onCleanup(props.onAppearanceChange(() => {
      setRowH(rowHeightSm())
      virt.measure()
    }))
  }

  let frame = 0
  onCleanup(() => cancelAnimationFrame(frame))
  const publish = (el: HTMLDivElement) => {
    frame = requestAnimationFrame(() => {
      setScrollEl(el)
      virt.measure()
    })
  }
  // Re-measure and go back to the top when the data is swapped out.
  createEffect(on(() => [props.columns, props.rows] as const, () => {
    const el = scrollEl()
    if (el) el.scrollTop = 0
    frame = requestAnimationFrame(() => virt.measure())
  }, { defer: true }))

  const template = () => `repeat(${props.columns.length}, var(--kit-grid-col))`

  return (
    <div class="ui-grid-scroll" ref={publish} role="grid" aria-label={props.ariaLabel} aria-rowcount={props.rows.length}>
      <div class="ui-grid">
        <div class="ui-grid-head" role="row" style={{ 'grid-template-columns': template() }}>
          <For each={props.columns}>{(column) => <span class="ui-grid-hcell" role="columnheader" title={column}>{column}</span>}</For>
        </div>
        <div class="ui-grid-body" style={{ height: `${virt.getTotalSize()}px` }}>
          <For each={virt.getVirtualItems()}>
            {(item) => (
              <div
                class="ui-grid-row"
                role="row"
                aria-rowindex={item.index + 1}
                aria-selected={props.selected === item.index}
                data-selected={props.selected === item.index ? '' : undefined}
                style={{ transform: `translateY(${item.start}px)`, height: `${rowH()}px`, 'grid-template-columns': template() }}
                onClick={() => props.onSelectRow?.(item.index)}
              >
                <For each={props.rows[item.index]}>
                  {(cell) => <span class="ui-grid-cell" role="gridcell" title={cell}>{cell}</span>}
                </For>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}
