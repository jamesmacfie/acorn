import { createEffect, createSignal, For, on, onCleanup } from 'solid-js'
import { createVirtualizer } from '@tanstack/solid-virtual'
import type { DbCell } from '../../../shared/database'

// A read-only, vertically-virtualized result grid (docs/pg.md). There's no generic table
// component in the client, so this rolls its own using the PullList/DiffView virtualizer recipe:
// a sticky header + absolutely-positioned rows inside an overflow-auto canvas. Columns are a fixed
// width so header and rows share one grid template and horizontal scroll just works.
// ponytail: fixed 200px columns; per-column autosize is a later add. Editing lives in the row
// detail panel, so the grid itself is display + selection only.
const COL_W = 200
const ROW_H = 30

export default function ResultGrid(props: {
  columns: string[]
  rows: DbCell[][]
  activeRow?: number | null
  onRowClick?: (index: number) => void
}) {
  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement>()
  const virt = createVirtualizer({
    get count() {
      return props.rows.length
    },
    getScrollElement: () => scrollEl() ?? null,
    estimateSize: () => ROW_H,
    overscan: 16,
  })
  let frame = 0
  onCleanup(() => cancelAnimationFrame(frame))
  const publish = (el: HTMLDivElement) => {
    frame = requestAnimationFrame(() => {
      setScrollEl(el)
      virt.measure()
    })
  }
  // Re-measure and scroll back to the top when the result set is swapped out.
  createEffect(on(() => [props.columns, props.rows] as const, () => {
    const el = scrollEl()
    if (el) el.scrollTop = 0
    frame = requestAnimationFrame(() => virt.measure())
  }, { defer: true }))

  const template = () => `repeat(${props.columns.length}, ${COL_W}px)`
  const width = () => `${props.columns.length * COL_W}px`

  return (
    <div class="dbgrid-scroll" ref={publish}>
      <div class="dbgrid" style={{ width: width() }}>
        <div class="dbgrid-head" style={{ 'grid-template-columns': template() }}>
          <For each={props.columns}>{(c) => <div class="dbgrid-hcell" title={c}>{c}</div>}</For>
        </div>
        <div class="dbgrid-body" style={{ height: `${virt.getTotalSize()}px` }}>
          <For each={virt.getVirtualItems()}>
            {(vi) => {
              const row = () => props.rows[vi.index]
              return (
                <div
                  class="dbgrid-row"
                  classList={{ active: props.activeRow === vi.index }}
                  style={{ transform: `translateY(${vi.start}px)`, height: `${ROW_H}px`, 'grid-template-columns': template() }}
                  onClick={() => props.onRowClick?.(vi.index)}
                >
                  <For each={row()}>
                    {(v) => (
                      <div class="dbgrid-cell" classList={{ 'is-null': v === null }} title={v ?? 'NULL'}>
                        {v === null ? 'NULL' : v}
                      </div>
                    )}
                  </For>
                </div>
              )
            }}
          </For>
        </div>
      </div>
    </div>
  )
}
