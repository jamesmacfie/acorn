/** @jsxImportSource @acorn/tui/jsx */
import { createEffect, createMemo, createSignal, For, Index, Show, untrack, type JSX } from 'solid-js'
import type { Renderable } from '../../tree/compat'
import type { Wheel } from '../../tree/hit'
import type { CollectionItem } from '@acorn/client-core/kit/keys'
import { createCellCollection, type ItemProps } from '../../keys/collection'
import { focusRenderable, focusedRenderable, scheduleSettle } from '../../keys/regions'
import { Line } from '../cells'

/** A virtual list uses the same thumb and track as the rest of the terminal. */
const THUMB = '█'
const TRACK = '│'

/**
 * A `Rows` item list that keeps its objects while the data behind them keeps theirs.
 *
 * `<For>` keys by object identity, so `items={tasks().map((task) => ({ key: task.id, task }))}` hands
 * it a new object per row on every change and every row renderable is destroyed and rebuilt — which
 * on the rail is every `tasks:changed`, and a rebuilt row is a row that has lost the caret and any
 * scroll position around it (docs/tui.md § Collections).
 *
 * Cache each wrapper by its source row. Query structural sharing then preserves renderables for
 * unchanged rows across refetches and reorders.
 *
 * The array is kept as well as the objects, so a render where nothing moved hands `<For>` the list it
 * already has.
 */
export function keyedRows<T, R extends CollectionItem>(
  items: () => readonly T[],
  build: (item: T) => R,
): () => readonly R[] {
  let cache = new Map<T, R>()
  let held: readonly R[] = []
  return createMemo(() => {
    const source = items()
    const next = new Map<T, R>()
    let same = source.length === held.length
    const rows = source.map((item, at) => {
      const row = cache.get(item) ?? build(item)
      next.set(item, row)
      if (held[at] !== row) same = false
      return row
    })
    cache = next
    if (same) return held
    held = rows
    return rows
  })
}

/** Items on successive lines. `virtual` is the scroll window and changes nothing else: the component
 *  is the virtualiser, because OpenTUI has none, and it draws only the rows that fit. */
export function Rows<T extends CollectionItem>(props: {
  id: string
  ariaLabel?: string
  items: readonly T[]
  tree?: boolean
  virtual?: boolean
  /** DOM-only density hint. Terminal rows are always one cell high. */
  rowHeight?: 'default' | 'rail'
  selected?: string | null
  onSelect?: (key: string) => void
  onActivate?: (key: string) => void
  onExpand?: (key: string, expand: boolean) => boolean | void
  onMenu?: (key: string) => void
  children: (item: T, itemProps: ItemProps, selected: () => boolean, place: Record<string, never>) => JSX.Element
}) {
  const items = createMemo(() => props.items)
  // One collection per `Rows`, keyed by the pane's own id, which is what the host store has always
  // been keyed by. Phase 0's stand-in was one store for every list on screen; this is the real thing
  // (../../keys/collection.ts).
  const collection = createCellCollection({
    id: () => props.id,
    items,
    // Moving the caret selects. This host's own answer, and the same kind of departure the focus
    // rules already make: with no pointer there is nothing else the caret could mean, and a reader
    // arrowing down a list of pull requests is asking to see them (docs/tui.md § Collections).
    //
    // Only `onSelect` fires on a move. `onActivate` still waits for Enter, so showing something is
    // immediate and opening it stays deliberate — which is the split `collectionIntents.ts` already
    // draws between `pick` and activate.
    selectOnMove: true,
    ...(props.selected === undefined ? {} : { selected: () => props.selected }),
    ...(props.onSelect ? { onSelect: props.onSelect } : {}),
    ...(props.onActivate ? { onActivate: props.onActivate } : {}),
    ...(props.onExpand ? { onExpand: props.onExpand } : {}),
    ...(props.onMenu ? { onMenu: props.onMenu } : {}),
  })
  const NO_PLACE = {} as Record<string, never>

  let box: Renderable | undefined
  const [rows, setRows] = createSignal(0)
  // Where the window starts. Kept rather than derived, so it moves only when the caret would leave
  // it: centring on the active row scrolled the whole list under the reader on every press, which is
  // not what any list in a terminal does. lazygit's rule — the view holds still until the caret walks
  // off an edge, then follows by exactly as much as it has to.
  const [top, setTop] = createSignal(0)
  let lastActive: string | null = null
  const clampTop = (value: number, length = items().length, fit = rows()) =>
    Math.max(0, Math.min(value, Math.max(0, length - fit)))

  // Keyboard movement remains authoritative for the caret: when the active key changes, reveal it
  // by the smallest amount. A mouse wheel changes `top` without changing `active`, so it can inspect
  // rows away from the selection and this effect only clamps that offset after a resize/refetch.
  createEffect(() => {
    const all = items()
    const fit = rows()
    const active = collection.active()
    const current = clampTop(untrack(top), all.length, fit)
    let next = current
    if (!props.virtual || !fit || all.length <= fit) next = 0
    else if (active !== lastActive) {
      const at = Math.max(0, all.findIndex((item) => item.key === active))
      next = Math.max(0, Math.min(Math.max(current, at - fit + 1), at, all.length - fit))
    }
    lastActive = active
    if (next !== untrack(top)) setTop(next)
  })

  const window = createMemo(() => {
    const all = items()
    const fit = rows()
    if (!props.virtual || !fit || all.length <= fit) {
      return { from: 0, items: all }
    }
    const from = clampTop(top(), all.length, fit)
    // Exactly what fits and no more. There is no scroll offset to overscan into: the box draws from
    // its own first row, so a row drawn beyond the window is a row drawn over the frame below it.
    return { from, items: all.slice(from, from + fit) }
  })

  // A virtual wheel may remove the focused row from the drawn slice. The collection box holds focus
  // while that row has no renderable; if a later wheel/key movement brings it back, restore the row
  // and therefore its caret. The key layer is focus-within on the same box, so keyboard fallback is
  // live in both states.
  createEffect(() => {
    window().from
    if (!box || focusedRenderable() !== box) return
    collection.focusActive()
  })

  // A region's contents are `lazy` and its rows come from a query, so a pane opens before its list
  // exists and the region lands the keys on its own box for want of anything better. Every arrival of
  // rows — the first response and every refetch after it — is a reason for the store to look again
  // (../../keys/regions.ts § The landing rule).
  createEffect(() => {
    items()
    scheduleSettle()
  })

  /** Where the thumb sits, or nothing where the whole list is on screen. */
  const bar = createMemo(() => {
    const all = items().length
    const fit = rows()
    if (!props.virtual || !fit || all <= fit) return null
    const size = Math.max(1, Math.round((fit * fit) / all))
    return { fit, size, at: Math.round((window().from * (fit - size)) / (all - fit)) }
  })

  return (
    <box
      flexDirection="row"
      // A virtual list is given its height by the panel it is in and windows to it. Left to size
      // itself it is as tall as its contents, which is the same number it then measures to decide how
      // many rows fit — so it always fitted, always drew everything, and overflowed the frame
      // (../../panel.tsx). Every other list keeps the kit's rule and takes the room its rows need.
      {...(props.virtual ? { flexGrow: 1, flexBasis: 0, flexShrink: 1 } : { flexShrink: 0 })}
      ref={(element: Renderable) => {
        box = element
        setRows(element.height)
        // Focusable for good, at mount, and the walk still counts the list once. `stopsIn` draws a
        // collection as the row its caret is on and falls back to the container only where there is
        // no such row, which is a virtual list whose active row is off its drawn window or a list
        // with no rows at all (../../keys/regions.ts § stopsIn).
        element.focusable = true
        collection.attach(element)
        scheduleSettle()
      }}
      onSizeChange={() => setRows(box?.height ?? 0)}
      onMouseScroll={(event: Wheel) => {
        if (!props.virtual) return
        const direction = event.scroll?.direction
        if (direction !== 'up' && direction !== 'down') return
        const amount = Math.max(1, Math.round(event.scroll?.delta ?? 1))
        const next = clampTop(top() + (direction === 'down' ? amount : -amount))
        if (next === top()) return
        // The wheel is about to take the focused row out of the drawn slice, so the container has to
        // hold the keys while it is gone. Asked for here rather than left to the renderer, which
        // focuses what a left click lands on and hears nothing from a wheel
        // (docs/tui.md § Collections).
        if (box) focusRenderable(box)
        setTop(next)
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
        <For each={window().items}>
          {(item) => props.children(item, collection.itemProps(item.key), () => collection.selected() === item.key, NO_PLACE)}
        </For>
      </box>
      <Show when={bar()}>
        {(place) => (
          <box flexDirection="column" flexShrink={0}>
            <Index each={Array.from({ length: place().fit })}>
              {(_cell, row) => (
                <Line role={row >= place().at && row < place().at + place().size ? 'strong' : 'muted'}>
                  {row >= place().at && row < place().at + place().size ? THUMB : TRACK}
                </Line>
              )}
            </Index>
          </box>
        )}
      </Show>
    </box>
  )
}
