import { createEffect, createSignal, For, on, onCleanup } from 'solid-js'
import { createVirtualizer } from '@tanstack/solid-virtual'
import { bindIntents } from '../keys/host'
import { watchAppearance } from '../lib/appearance'
import type { Intent } from '../keys/intents'
import { rowHeightSm } from '../lib/metrics'

/* Grid: Table for data that does not fit. Same meaning, virtualised rows, one sticky header.

   Two components rather than one flag, because the geometry is different in kind: Table lets the
   browser size its columns, and a virtualised list cannot — the row height and the column track
   both have to be numbers before a row is drawn. See docs/ui-design.md § The closed kit.

   Cells are strings. A cell that wants a Badge wants a Table.

   At 80×24: as Table, with a row-range indicator. */
let gridSeq = 0

export function Grid(props: {
  columns: readonly string[]
  rows: readonly (readonly string[])[]
  /** Index into `rows`. The host owns the selection; this reflects it. */
  selected?: number | null
  onSelect?: (index: number) => void
  ariaLabel: string
}) {
  // An id of its own rather than the label's: `aria-activedescendant` needs a DOM id, and a label is
  // a sentence.
  const gridId = `ui-grid-${++gridSeq}`
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
  // Re-read the density token when the style pack changes, and measure again against it. Watched here
  // rather than passed in: this component is always the host's, on both render paths, so there is always
  // a shell signal to watch. A plugin drawing a `Grid` in a tree is not drawing it — the host is.
  onCleanup(watchAppearance(() => {
    setRowH(rowHeightSm())
    virt.measure()
  }))

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

  // A grid's rows are a collection, but a virtualised one: most of them have no element, so the
  // arrows move the selection and scroll it into view rather than moving DOM focus. That is the
  // ratatui shape — the widget is a renderer and the state is outside it — and it is the only one
  // that survives virtualisation.
  const step = (delta: number, absolute?: 'first' | 'last'): boolean => {
    if (!props.rows.length || !props.onSelect) return false
    const at = props.selected ?? -1
    const next = absolute === 'first' ? 0
      : absolute === 'last' ? props.rows.length - 1
      : Math.min(Math.max((at < 0 ? 0 : at) + delta, 0), props.rows.length - 1)
    props.onSelect(next)
    virt.scrollToIndex(next)
    return true
  }
  const handle = (intent: Intent): boolean => {
    switch (intent) {
      case 'next': return step(1)
      case 'prev': return step(-1)
      case 'first': return step(0, 'first')
      case 'last': return step(0, 'last')
      case 'pageNext': return step(10)
      case 'pagePrev': return step(-10)
      default: return false
    }
  }
  const GRID_INTENTS: readonly Intent[] = ['next', 'prev', 'first', 'last', 'pageNext', 'pagePrev']

  return (
    <div
      class="ui-grid-scroll"
      ref={(el) => { publish(el); bindIntents(el, GRID_INTENTS, handle) }}
      role="grid"
      tabindex="0"
      aria-label={props.ariaLabel}
      aria-rowcount={props.rows.length}
      aria-activedescendant={props.selected == null ? undefined : `${gridId}-row-${props.selected}`}
    >
      <div class="ui-grid">
        <div class="ui-grid-head" role="row" style={{ 'grid-template-columns': template() }}>
          <For each={props.columns}>{(column) => <span class="ui-grid-hcell" role="columnheader" title={column}>{column}</span>}</For>
        </div>
        <div class="ui-grid-body" style={{ height: `${virt.getTotalSize()}px` }}>
          <For each={virt.getVirtualItems()}>
            {(item) => (
              <div
                class="ui-grid-row"
                id={`${gridId}-row-${item.index}`}
                role="row"
                aria-rowindex={item.index + 1}
                aria-selected={props.selected === item.index}
                data-selected={props.selected === item.index ? '' : undefined}
                style={{ transform: `translateY(${item.start}px)`, height: `${rowH()}px`, 'grid-template-columns': template() }}
                onClick={() => props.onSelect?.(item.index)}
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
