import { measureWork } from '../../lib/telemetry/workTelemetry'
import { createEffect, createMemo, For, on, onCleanup, createSignal, type JSX } from 'solid-js'
import { createVirtualizer } from '@tanstack/solid-virtual'
import { createCollection, type CollectionItem, type ItemProps } from '../../keys/collection'
import { watchAppearance } from '../../tokens/appearance'
import { railRowHeight, rowHeight } from '../../lib/layout/metrics'

// Rows: the run of `Row`s or `TreeRow`s, as a node.
//
// `Row` has always been "an item in a collection" (docs/ui-design.md § The closed kit), and until now the
// collection was whatever `<div>` the pane happened to wrap it in — which is why arrow keys worked in
// three lists and nowhere else. This is that container, and it is the only thing a pane has to write
// to get arrows, Home, End, the page keys, type-ahead, `aria-activedescendant` and a selection that
// survives a refetch. The pane writes no key handling at all.
//
// Items are data rather than children, because the collection needs the keys before the rows are
// drawn: roving focus, type-ahead and the stored place are all keyed by the item's own key, not by
// its position. See ../keys/collection.ts.
//
// At 80×24: the rows on successive lines, the active one marked.

/** Where a virtualised row sits, in pixels. A measurement rather than a design decision: only the
 *  virtualizer knows both numbers, and `Row` takes them as `offset` and `height`. Both are absent
 *  outside a virtual list, where the rows sit in normal flow. */
export type RowPlacement = { offset?: number; height?: number }

export function Rows<T extends CollectionItem>(props: {
  /** Keys the host's stored `active` and `selected`. Stable across a rebuild of `items`. */
  id: string
  ariaLabel?: string
  items: readonly T[]
  /** Draws as a tree rather than a list, for a run of `TreeRow`s. */
  tree?: boolean
  /**
   * Draw only the rows on screen, in a scroller of this node's own.
   *
   * The list a pane writes does not change: the same `items`, the same body. What changes is that the
   * body is called for the rows in view and is handed each one's placement to pass to `Row`. Roving
   * focus still walks the whole list, because the keys are the collection's and the scroller is asked
   * to reach a row before it is focused (../keys/collection.ts § scrollToKey).
   */
  virtual?: boolean
  /** Virtual rows in a collapsed sidebar are square with the surrounding icon rails. */
  rowHeight?: 'default' | 'rail'
  /** Controlled selection, and all of it: supplying this hands `selected` to the caller. */
  selected?: string | null
  onSelect?: (key: string) => void
  onActivate?: (key: string) => void
  onExpand?: (key: string, expand: boolean) => boolean | void
  onMenu?: (key: string) => void
  /** `selected` is an accessor, not a boolean: a `<For>` body runs once per row, so a value read
   *  there would never change again. Read it inside the JSX prop. */
  children: (item: T, itemProps: ItemProps, selected: () => boolean, place: RowPlacement) => JSX.Element
}) {
  // Read once. Whether a list is virtualised is a fact about the pane that wrote it, not a signal, and
  // the two paths below build different machinery.
  const virtual = props.virtual === true
  let virt: ReturnType<typeof createVirtualizer<HTMLDivElement, Element>> | undefined

  const [pendingReveal, setPendingReveal] = createSignal<string>()
  const [viewportHeight, setViewportHeight] = createSignal(0)
  const NO_PLACE: RowPlacement = {}

  // The same object back for an unchanged row, so `<For>` below reconciles instead of remounting.
  //
  // A list rebuilt from a live store hands out fresh item objects on every frame — the agents sidebar
  // rebuilds its roster on every event the socket delivers — and reference keying would dispose and
  // recreate every row several times a second. Focus and selection survive that, because both live in
  // the host's store keyed by `item.key`, but the DOM does not, and neither does a text selection or
  // an open menu inside a row. Held only while every field matches: an item whose `label` or
  // `disabled` changed is a different row and must redraw.
  const cache = new Map<string, T>()
  const items = createMemo<readonly T[]>(() => measureWork('rows.reconcile', () => {
    const present = new Set<string>()
    const next = props.items.map((item: T) => {
      present.add(item.key)
      const held = cache.get(item.key)
      const same = held && Object.keys(item).length === Object.keys(held).length
        && Object.entries(item).every(([field, value]) => (held as Record<string, unknown>)[field] === value)
      if (!same) cache.set(item.key, item)
      return same ? held! : item
    })
    for (const key of cache.keys()) if (!present.has(key)) cache.delete(key)
    return next
  }, { items: props.items.length }))

  const collection = createCollection({
    id: () => props.id,
    items: () => items(),
    role: props.tree ? 'tree' : 'listbox',
    ...(virtual
      ? {
        scrollToKey: (key: string) => {
          const index = items().findIndex((item) => item.key === key)
          if (index >= 0) {
            setPendingReveal(key)
            virt?.scrollToIndex(index)
          }
        },
      }
      : {}),
    ...(props.selected !== undefined ? { selected: () => props.selected } : {}),
    ...(props.onSelect ? { onSelect: props.onSelect } : {}),
    ...(props.onActivate ? { onActivate: props.onActivate } : {}),
    ...(props.onExpand ? { onExpand: props.onExpand } : {}),
    ...(props.onMenu ? { onMenu: props.onMenu } : {}),
  })

  if (!virtual) {
    return (
      <div class="ui-rows" aria-label={props.ariaLabel} {...collection.containerProps}>
        <For each={items()}>
          {(item) => measureWork('rows.item.mount', () => props.children(item, collection.itemProps(item.key), () => collection.selected() === item.key, NO_PLACE))}
        </For>
      </div>
    )
  }

  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement>()
  // Row height comes from --row-h-virt so a style pack's density reaches the list. The virtualizer
  // writes its answer back as an inline height, which beats any stylesheet rule, so a number read from
  // the token is the only way density is real here (./metrics.ts).
  const measuredRowHeight = () => props.rowHeight === 'rail' ? railRowHeight() : rowHeight()
  const [rowH, setRowH] = createSignal(measuredRowHeight())
  virt = createVirtualizer({
    get count() { return items().length },
    getScrollElement: () => scrollEl() ?? null,
    estimateSize: () => rowH(),
    overscan: 12,
    onChange: (instance) => setViewportHeight(instance.scrollRect?.height ?? 0),
  })
  const updateRowHeight = () => {
    const next = measuredRowHeight()
    setRowH(next)
    // These rows have a fixed height, so update every cached measurement explicitly. `measure()`
    // alone clears the estimate but leaves the already-rendered slot objects at their old sizes.
    for (let index = 0; index < items().length; index++) virt?.resizeItem(index, next)
  }
  onCleanup(watchAppearance(updateRowHeight))
  createEffect(on(() => props.rowHeight, updateRowHeight, { defer: true }))

  let frame = 0
  let publishFrame = 0
  onCleanup(() => { cancelAnimationFrame(frame); cancelAnimationFrame(publishFrame) })
  const measureSoon = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => virt?.measure())
  }
  // Published after layout rather than in the ref, so the first rect the virtualizer observes is the
  // one the layout gave the scroller rather than a zero-height box.
  const publish = (element: HTMLDivElement) => {
    cancelAnimationFrame(publishFrame)
    publishFrame = requestAnimationFrame(() => {
      setScrollEl(element)
      virt?.measure()
    })
  }
  createEffect(on(() => items().length, measureSoon, { defer: true }))

  // Key visible owners by their reconciled item, rather than by virtualizer slot index.
  // Placement remains reactive when expansion moves a surviving row to another slot.
  const placements = createMemo(() => new Map(virt!.getVirtualItems().flatMap((slot) => {
    const row = items()[slot.index]
    return row ? [[row.key, slot.start] as const] : []
  })))
  const visible = createMemo(() => {
    const positions = placements()
    return positions.size ? [...positions.keys()].map((key) => cache.get(key)!) : items().slice(0, 12)
  })
  createEffect(() => {
    const key = pendingReveal()
    const height = viewportHeight()
    if (!key || height <= 0) return
    const index = items().findIndex((item) => item.key === key)
    if (index >= 0) virt!.scrollToIndex(index)
    setPendingReveal(undefined)
  })

  return (
    <div class="ui-rows-scroll" ref={publish}>
      <div
        class="ui-rows"
        aria-label={props.ariaLabel}
        {...collection.containerProps}
        style={{ height: `${virt.getTotalSize()}px`, position: 'relative' }}
      >
        <For each={visible()}>
          {(item) => measureWork('rows.item.mount', () => props.children(
            item,
            collection.itemProps(item.key),
            () => collection.selected() === item.key,
            {
              get offset() { return placements().get(item.key) ?? items().indexOf(item) * rowH() },
              get height() { return rowH() },
            },
          ))}
        </For>
      </div>
    </div>
  )
}
