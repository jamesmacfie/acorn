/** @jsxImportSource @acorn/tui/jsx */
import { createMemo, createSignal, Index, Show, type JSX } from 'solid-js'
import type { Renderable } from '../../tree/compat'
import { COLLECTION_INTENTS, createCollectionIntents, type Intent } from '@acorn/client-core/kit/keys'
import { stop } from '../../keys/stops'
import { flatten, Line, pad } from '../cells'

// The narrowest a column may be before it is worth dropping instead. Below this a cell is an
// ellipsis and the reader learns nothing from the column being there.
const MIN_COLUMN = 6
const PRIORITY_ORDER = { low: 0, normal: 1, high: 2 } as const

type Column = { priority: 'high' | 'normal' | 'low'; label: string }
type TableState = {
  width: () => number
  register: (column: Column) => number
  hidden: (index: number) => boolean
  columnWidth: () => number
}

// A table decides its own columns, so the head and the cells have to hear the decision. A module
// signal rather than a context, because a table's rows are drawn by the caller and a context would
// mean the caller wrapping them: one table is being built at a time in a synchronous render pass,
// which is the same assumption `Rows` makes about its own registration.
let building: TableState | null = null

/** reduced: box-drawn, truncating columns by the priority its heads declare. */
export function Table(props: { size?: 'sm' | 'md'; stickyHead?: boolean; minWidth?: number; children: JSX.Element }) {
  let box: Renderable | undefined
  const [width, setWidth] = createSignal(80)
  const [columns, setColumns] = createSignal<Column[]>([])

  const fits = createMemo(() => Math.max(1, Math.floor(width() / MIN_COLUMN)))
  // Drop the lowest priority first, then the rightmost of equal priority, which is the order a reader
  // gives up on a table's columns anyway.
  const kept = createMemo(() => {
    const all = columns().map((column, index) => ({ ...column, index }))
    if (all.length <= fits()) return new Set(all.map((column) => column.index))
    const order = [...all].sort((a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority] || a.index - b.index)
    return new Set(order.slice(0, fits()).map((column) => column.index))
  })
  const lost = () => columns().filter((_column, index) => !kept().has(index)).map((column) => column.label)

  const state: TableState = {
    width,
    register: (column) => {
      let index = 0
      setColumns((current) => {
        index = current.length
        return [...current, column]
      })
      return index
    },
    hidden: (index) => columns().length > 0 && !kept().has(index),
    columnWidth: () => Math.max(MIN_COLUMN, Math.floor(width() / Math.max(1, kept().size))),
  }
  building = state

  return (
    <box
      flexDirection="column"
      ref={(element: Renderable) => { box = element; setWidth(element.width) }}
      onSizeChange={() => setWidth(box?.width ?? 80)}
    >
      {props.children}
      {/* Naming what was lost, rather than counting it: a reader who can see that two columns are
          missing still has to widen the pane to find out whether either was the one they wanted. */}
      <Show when={lost().length}>
        <Line role="muted">{`+ ${lost().join(' ')}`}</Line>
      </Show>
    </box>
  )
}

/** reduced: the column's label in the bold header line; the lowest priority is dropped first, and a
 *  muted line under the table names what was lost. */
export function TableHead(props: { align?: 'start' | 'center' | 'end'; priority?: 'high' | 'normal' | 'low'; children?: JSX.Element }) {
  const table = building
  const index = table?.register({ priority: props.priority ?? 'normal', label: flatten(props.children) }) ?? 0
  return (
    <Show when={!table?.hidden(index)}>
      <Line role="strong">{pad(flatten(props.children), table?.columnWidth() ?? 12)}</Line>
    </Show>
  )
}

/** reduced: one line, cells separated by `│`, truncated by column priority. */
export function TableRow(props: { head?: boolean; onPress?: () => void; children: JSX.Element }) {
  const control = stop({ onPress: () => props.onPress?.() })
  return (
    <box
      flexDirection="row"
      gap={1}
      ref={(element: Renderable) => { if (props.onPress) control.ref(element) }}
    >
      {props.children}
      {/* The caret goes after the cells rather than before them, and it is the one place in the kit
          where it does: a table's columns line up across rows, and a cell of caret in front of the
          first one would move every column of the focused row one to the right. The cells themselves
          are the caller's `TableCell`s, so this row cannot restyle them. */}
      <Show when={control.focused()}><Line tone="accent">›</Line></Show>
    </box>
  )
}

/** reduced: the cell's text in its column's width, ellipsised where it does not fit. */
export function TableCell(props: { align?: 'start' | 'center' | 'end'; header?: boolean; children?: JSX.Element }) {
  const table = building
  return <Line role={props.header ? 'strong' : 'body'}>{pad(flatten(props.children), table?.columnWidth() ?? 12)}</Line>
}

/** reduced: as `Table`, with a row-range indicator instead of a scrollbar, and cells that are
 *  strings, which is what makes the arithmetic possible at all. */
export function Grid(props: {
  columns: readonly string[]
  rows: readonly (readonly string[])[]
  selected?: number | null
  onSelect?: (index: number) => void
  ariaLabel: string
}) {
  let box: Renderable | undefined
  const [size, setSize] = createSignal({ width: 80, height: 10 })
  const measure = (element: Renderable | undefined) => {
    if (element) setSize({ width: element.width, height: element.height })
  }
  const fits = () => Math.max(1, Math.floor(size().width / MIN_COLUMN))
  const shown = () => props.columns.slice(0, fits())
  const columnWidth = () => Math.max(MIN_COLUMN, Math.floor(size().width / Math.max(1, shown().length)))
  // Two lines go to the header and the range, so the window is what is left.
  const visible = () => Math.max(1, size().height - 2)
  const from = () => {
    const at = props.selected ?? 0
    return Math.min(Math.max(0, at - Math.floor(visible() / 2)), Math.max(0, props.rows.length - visible()))
  }
  const line = (cells: readonly string[]) => shown().map((_column, index) => pad(cells[index] ?? '', columnWidth())).join('│')

  // `NODE_FOCUS` calls `Grid` a collection, but its rows are strings rather than
  // renderables — that is what makes its arithmetic possible at all — so there is nothing per row to
  // focus: the grid is the one stop, `↑`/`↓` move the `selected` index the caller holds, and the
  // window follows it. Same intents, same wrapping, same page keys as every other collection, because
  // they are the shared ones (client-core kit/keys/collectionIntents.ts).
  const keys = createCollectionIntents({
    id: () => props.ariaLabel,
    items: () => props.rows.map((_row, index) => ({ key: String(index) })),
    selectOnMove: true,
    selected: () => (props.selected === null || props.selected === undefined ? null : String(props.selected)),
    onSelect: (key) => props.onSelect?.(Number(key)),
    land: () => {},
    onItem: () => false,
  })
  const control = stop({
    on: Object.fromEntries(COLLECTION_INTENTS.map((intent) => [intent, () => keys.handle(intent)])) as
      Partial<Record<Intent, () => boolean>>,
  })

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      ref={(element: Renderable) => {
        box = element
        measure(element)
        control.ref(element)
      }}
      onSizeChange={() => measure(box)}
    >
      <Line role="strong">{line(props.columns)}</Line>
      <Index each={props.rows.slice(from(), from() + visible())}>
        {(row, index) => (
          <Line role={props.selected === from() + index ? 'match' : 'body'}>{line(row())}</Line>
        )}
      </Index>
      <Line role="muted">
        {`${props.rows.length ? from() + 1 : 0}–${Math.min(props.rows.length, from() + visible())} of ${props.rows.length}`}
        {props.columns.length > shown().length ? ` · ${props.columns.length - shown().length} more columns` : ''}
      </Line>
    </box>
  )
}
