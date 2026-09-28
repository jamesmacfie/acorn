/** @jsxImportSource @acorn/tui/jsx */
import { createSignal, Show, type JSX } from 'solid-js'
import type { Renderable } from '../../tree/compat'
import { Line } from '../cells'
import { ScrollViewport } from '../scrolling'

// The narrow ceiling for the two-column nodes. The same number the `list-detail` layout uses, and for
// the same reason: below it there is no room for a list and a document side by side. A node asks its
// own box how wide it turned out; nothing here reads the terminal.
const NARROW_AT = 80
const LIST_CELLS = 32

/** reduced: two columns above 80 cells, one at a time below. Which one is drawn below the ceiling is
 *  "the detail if there is one", because a caller that passed a detail has something to show.
 *
 *  `collapseKey` is ignored. Collapsing a sidebar to a rail of marks only reads because the names it
 *  drops come back as tooltips, and this host has neither hover nor `tip` (../ui.ts). Narrowing here
 *  is the `NARROW_AT` switch below, which shows one column at a time and loses no names. */
export function ListDetail(props: {
  list?: JSX.Element
  split?: boolean
  listLabel?: string
  listWidth?: 'narrow' | 'default' | 'wide'
  scrollDetail?: boolean
  detailAs?: 'div' | 'main'
  collapseKey?: string
  children: JSX.Element
}) {
  let box: Renderable | undefined
  const [width, setWidth] = createSignal(NARROW_AT)
  const narrow = () => width() < NARROW_AT
  return (
    <box
      flexDirection="row"
      flexGrow={1}
      ref={(element: Renderable) => { box = element; setWidth(element.width) }}
      onSizeChange={() => setWidth(box?.width ?? NARROW_AT)}
    >
      {/* `split` is the form where both columns are children — a `ListColumn` and a `DetailColumn` —
          rather than one of them arriving in `list`. The DOM hands those straight to its grid; this
          gated on `list ?? split` and so drew an empty 32-cell gutter beside the pr pane's navigator
          for a `list` nobody passed (docs/tui.md).
          Below 80 cells the two stack instead of sitting side by side, which is this node's own
          answer to "one column at a time": it has no keys of its own to switch with, and a column of
          38 cells is a column nobody can read. */}
      <Show when={props.list !== undefined} fallback={
        <box flexDirection={narrow() ? 'column' : 'row'} flexGrow={1}>{props.children}</box>
      }>
        <Show when={!narrow()}>
          <box flexDirection="column" width={LIST_CELLS}>{props.list}</box>
          <box width={1}><Line>│</Line></box>
        </Show>
        <box flexDirection="column" flexGrow={1}>{props.children}</box>
      </Show>
    </box>
  )
}

/** reduced: the left column, or the whole width when the split has collapsed. The width is the
 *  parent's; this node draws the label and the scroll. */
export function ListColumn(props: { label?: string; scroll?: boolean; children: JSX.Element }) {
  return (
    <box flexDirection="column" flexGrow={1}>
      {/* In a box of its own so the deficit a taller-than-the-screen column creates cannot be taken out
          of the label: a one-line run given half a line lands on the line above it, which drew this
          column's own name over the heading under it
          (docs/tui.md). */}
      <Show when={props.label}><box flexShrink={0}><Line role="eyebrow">{props.label!}</Line></box></Show>
      {/* The label sits above the viewport and not inside it. It is the column's own name, so it
          stays put while the rows under it move; scrolling a heading off its own list leaves a
          reader looking at rows that belong to nothing. */}
      {props.scroll ? <ScrollViewport>{props.children}</ScrollViewport> : props.children}
    </box>
  )
}

export function DetailColumn(props: { scroll?: boolean; children: JSX.Element }) {
  return (
    <box flexDirection="column" flexGrow={1}>
      {props.scroll ? <ScrollViewport>{props.children}</ScrollViewport> : props.children}
    </box>
  )
}

/** absent: a terminal split moves by a key, not a grip. Nothing is drawn and nothing is a stop. */
export const SplitHandle = (_props: { axis: 'x' | 'y'; drag: unknown }) => null
