import { measureWork } from '../../lib/telemetry/workTelemetry'
import { createEffect, createMemo, For, on, onCleanup, createSignal, Show, type JSX } from 'solid-js'
import { createVirtualizer } from '@tanstack/solid-virtual'
import { createCollection, type ItemProps } from '../../keys/collection'
import { collectionState, setCollectionOffset } from '../../keys/collectionState'
import { bindIntents } from '../../keys/keymapHost'
import { IconButton } from '../inputs/IconButton'
import { Menu } from '../overlays/Menu'
import { createRowsDrag } from './rowsDrag'
import { createRowsReorder, type ReorderableItem } from './rowsReorder'
import { watchAppearance } from '../../tokens/appearance'
import { railRowHeight, rowHeight } from '../../lib/layout/metrics'
import { retainScroll } from '../../lib/layout/retainScroll'

// Rows: the run of `Row`s or `TreeRow`s, as a node.
//
// `Row` is "an item in a collection" (docs/ui-design/closed-kit.md § The closed kit), and this is the
// collection. It is the only thing a pane has to write to get arrows, Home, End, the page keys,
// type-ahead, `aria-activedescendant` and a selection that survives a refetch. The pane writes no key
// handling at all.
//
// Items are data rather than children, because the collection needs the keys before the rows are
// drawn: roving focus, type-ahead and the stored place are all keyed by the item's own key, not by
// its position. See `createCollection`.
//
// At 80×24: the rows on successive lines, the active one marked.

/** Where a virtualised row sits, in pixels. A measurement rather than a design decision: only the
 *  virtualizer knows both numbers, and `Row` takes them as `offset` and `height`. Both are absent
 *  outside a virtual list, where the rows sit in normal flow. */
export type RowPlacement = { offset?: number; height?: number }

export function Rows<T extends ReorderableItem>(props: {
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
   * to reach a row before it is focused (`scrollToKey`).
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
  /** Lets a person reorder the rows: each one not marked `fixed` gets a grip to drag, or to open for
   *  Move up and Move down, and Alt+↑/↓ moves the active row. Called with every movable key in the new
   *  order. The rows show that order until it settles, so resolve once `items` holds it, and reject to
   *  put the old order back. Not with `virtual`. Leave it off, for a collapsed rail, to hide the grips. */
  onReorder?: (keys: string[]) => Promise<unknown>
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
  const items = createMemo<readonly T[]>(() =>
    measureWork(
      'rows.reconcile',
      () => {
        const present = new Set<string>()
        const next = props.items.map((item: T) => {
          present.add(item.key)
          const held = cache.get(item.key)
          const same =
            held &&
            Object.keys(item).length === Object.keys(held).length &&
            Object.entries(item).every(([field, value]) => (held as Record<string, unknown>)[field] === value)
          if (!same) cache.set(item.key, item)
          return same ? held! : item
        })
        for (const key of cache.keys()) if (!present.has(key)) cache.delete(key)
        return next
      },
      { items: props.items.length },
    ),
  )

  let list: HTMLDivElement | undefined
  const reorder = createRowsReorder({
    items,
    save: () => (virtual ? undefined : props.onReorder),
    // A move redraws the rows, and a row the browser moved has lost its focus. Give it back, unless the
    // reader has gone somewhere else while the order saved.
    settled: (key) =>
      queueMicrotask(() => {
        const focused = document.activeElement
        if (focused && focused !== document.body && !list?.contains(focused)) return
        list?.querySelector<HTMLElement>(`[data-collection-key="${CSS.escape(key)}"]`)?.focus()
      }),
  })
  const reorderable = () => !virtual && !!props.onReorder
  const movable = (key: string) => !items().find((item) => item.key === key)?.fixed
  const drag = createRowsDrag({
    list: () => list,
    canDrag: (key) => reorderable() && !reorder.busy() && movable(key) && items().filter((i) => !i.fixed).length > 1,
    canDrop: movable,
    drop: (key, target, position) => void reorder.move(key, target, position),
  })

  const collection = createCollection({
    id: () => props.id,
    // What the reader sees, so the arrows walk a pending order the way it is drawn.
    items: () => reorder.shown(),
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
      <>
        <div
          class="ui-rows"
          aria-label={props.ariaLabel}
          {...collection.containerProps}
          ref={(element: HTMLDivElement) => {
            list = element
            ;(collection.containerProps.ref as (element: HTMLElement) => void)(element)
            bindIntents(element, ['moveUp', 'moveDown'], (intent) => {
              const key = collection.active()
              return reorderable() && !!key && movable(key) && reorder.shift(key, intent === 'moveUp' ? -1 : 1)
            })
          }}
        >
          <For each={reorder.shown()}>
            {(item) => {
              const row = measureWork('rows.item.mount', () =>
                props.children(
                  item,
                  collection.itemProps(item.key),
                  () => collection.selected() === item.key,
                  NO_PLACE,
                ),
              )
              // The grip sits beside the row rather than in it, so the row stays one option with
              // nothing to press inside it. A fixed row keeps the grip's width, so the names line up.
              return (
                <Show when={reorderable()} fallback={row}>
                  <div
                    class="ui-rows-reorder"
                    data-reorder-key={item.key}
                    data-dragging={drag.dragKey() === item.key ? '' : undefined}
                    data-drop-position={drag.dropTarget()?.key === item.key ? drag.dropTarget()?.position : undefined}
                  >
                    <Show when={!item.fixed} fallback={<span class="ui-rows-grip" />}>
                      <ReorderGrip
                        label={`Reorder ${item.label ?? 'row'}`}
                        busy={reorder.busy()}
                        edges={reorder.edges(item.key)}
                        onPointerDown={(event) => drag.begin(event, item.key)}
                        consumeClick={() => drag.consumeClick(item.key)}
                        shift={(delta) => reorder.shift(item.key, delta)}
                      />
                    </Show>
                    {row}
                  </div>
                </Show>
              )
            }}
          </For>
        </div>
        <Show when={reorderable()}>
          <span class="sr-only" role="status">
            {reorder.announcement()}
          </span>
        </Show>
      </>
    )
  }

  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement>()
  const [scrollOffset, setScrollOffset] = createSignal(0)
  // Row height comes from --row-h-virt so a style pack's density reaches the list. The virtualizer
  // writes its answer back as an inline height, which beats any stylesheet rule, so a number read from
  // the token is the only way density is real here (`rowHeight`).
  const measuredRowHeight = () => (props.rowHeight === 'rail' ? railRowHeight() : rowHeight())
  const [rowH, setRowH] = createSignal(measuredRowHeight())
  virt = createVirtualizer({
    get count() {
      return items().length
    },
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
  onCleanup(() => {
    cancelAnimationFrame(frame)
    cancelAnimationFrame(publishFrame)
  })
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
      setViewportHeight(element.clientHeight)
      virt?.measure()
    })
  }
  createEffect(on(() => items().length, measureSoon, { defer: true }))

  // Key visible owners by their reconciled item, rather than by virtualizer slot index.
  // Placement remains reactive when expansion moves a surviving row to another slot.
  const placements = createMemo(() => {
    const rows = items()
    const height = viewportHeight()
    const offset = scrollOffset()
    const slots = virt!.getVirtualItems()
    // WebKit can expose a scrollable element before the virtualizer has its viewport or scroll
    // offset. Derive a bounded window from the element while its slots still describe the top.
    const stale = !slots.length || slots[slots.length - 1]!.end < offset || slots[0]!.start > offset + height
    if (height > 0 && (!virt!.scrollRect?.height || stale)) {
      const size = rowH()
      const start = Math.max(0, Math.floor(offset / size) - 4)
      const end = Math.min(rows.length, Math.ceil((offset + height) / size) + 4)
      return new Map(rows.slice(start, end).map((row, index) => [row.key, (start + index) * size] as const))
    }
    return new Map(
      slots.flatMap((slot) => {
        const row = rows[slot.index]
        return row ? [[row.key, slot.start] as const] : []
      }),
    )
  })
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
    // The offset goes in the collection's stored state beside `active` and `selected`, so a sidebar
    // that is left and opened again comes back where the reader was rather than at the top.
    <div
      class="ui-rows-scroll"
      ref={(element) => {
        retainScroll(element, {
          key: () => props.id,
          read: (id) => collectionState(id).offset,
          write: setCollectionOffset,
        })
        publish(element)
      }}
      onScroll={(event) => {
        setScrollOffset(event.currentTarget.scrollTop)
        setViewportHeight(event.currentTarget.clientHeight)
      }}
    >
      <div
        class="ui-rows"
        aria-label={props.ariaLabel}
        {...collection.containerProps}
        style={{ height: `${virt.getTotalSize()}px`, position: 'relative' }}
      >
        <For each={visible()}>
          {(item) =>
            measureWork('rows.item.mount', () =>
              props.children(item, collection.itemProps(item.key), () => collection.selected() === item.key, {
                get offset() {
                  return placements().get(item.key) ?? items().indexOf(item) * rowH()
                },
                get height() {
                  return rowH()
                },
              }),
            )
          }
        </For>
      </div>
    </div>
  )
}

/** A row's handle: drag it, or press it for Move up and Move down. The project table's handle, in kit
 *  form (features/workspaces/ProjectOrderHandle.tsx). */
function ReorderGrip(props: {
  label: string
  busy: boolean
  edges: { first: boolean; last: boolean }
  onPointerDown: (event: PointerEvent) => void
  consumeClick: () => boolean
  shift: (delta: -1 | 1) => void
}) {
  return (
    <span class="ui-rows-grip" onPointerDown={(event) => props.onPointerDown(event)}>
      <Menu
        ariaLabel={props.label}
        trigger={({ open, toggle }) => (
          <IconButton
            icon="grip-vertical"
            label={props.label}
            tip="Drag to reorder"
            tipSub="Or open the menu to move up or down."
            tipKey="Alt+↑/↓"
            disabled={props.busy || (props.edges.first && props.edges.last)}
            opens="menu"
            expanded={open()}
            onPress={() => {
              if (!props.consumeClick()) toggle()
            }}
          />
        )}
      >
        {(menu) => (
          <>
            <Menu.Item context={menu} disabled={props.busy || props.edges.first} onSelect={() => props.shift(-1)}>
              Move up
            </Menu.Item>
            <Menu.Item context={menu} disabled={props.busy || props.edges.last} onSelect={() => props.shift(1)}>
              Move down
            </Menu.Item>
          </>
        )}
      </Menu>
    </span>
  )
}
