/** @jsxImportSource @acorn/tui/jsx */
import { children, createSignal, Show, type JSX } from 'solid-js'
import type { Renderable } from '../../tree/compat'
import { Rule } from '../cells'
import { ScrollViewport } from '../scrolling'
import { regionFocus } from '../../keys/regions'
import { paneIdForFocus } from '../paneContext'

// The narrow ceiling for the two-column nodes. The same number the `list-detail` layout uses, and for
// the same reason: below it there is no room for a list and a document side by side. A node asks its
// parent box how wide it turned out; nothing here reads the terminal.
const NARROW_AT = 80
// The list's width for each of the DOM's three column genres, in about the proportions of their
// pixel widths (client-core/infra/styles/tokens-style.css § --listdetail-w).
const LIST_CELLS = { narrow: 20, default: 32, wide: 48 } as const

/** Two columns above 80 cells; below it the list stays reachable above the detail.
 *
 *  `collapseKey` is ignored. Collapsing a sidebar to a rail of marks only reads because the names it
 *  drops come back as tooltips, and this host has neither hover nor `tip` (../ui.ts). Narrowing here
 *  is the `NARROW_AT` switch below, which stacks the regions and loses no names. */
export function ListDetail(props: {
  list?: JSX.Element
  split?: boolean
  listLabel?: string
  listWidth?: 'narrow' | 'default' | 'wide'
  /** The list here is a fixed width with no grip to resize it, so there is no width to keep. */
  widthKey?: string
  scrollDetail?: boolean
  detailAs?: 'div' | 'main'
  collapseKey?: string
  /** The terminal keeps the full list readable, so it ignores this DOM collapse choice. */
  collapseContent?: 'rows' | 'empty'
  /** The phone's one-column-at-a-time rule. This host stacks by width instead, so it ignores it. */
  selection?: string | null
  children: JSX.Element
}) {
  const paneId = paneIdForFocus()
  // JSX props can be getters. Hold each subtree once so a width update cannot recreate its
  // document and discard an armed file action while the dialog takes focus. `children()` holds them
  // the same way and lets the `split` form take its first column apart from the rest, which is what
  // the DOM's grid does with the same two children.
  const list = props.list
  const columns = children(() => props.children)
  const listSide = () => (list !== undefined ? list : props.split ? columns.toArray()[0] : undefined)
  const detailSide = () => (list === undefined && props.split ? columns.toArray().slice(1) : columns())
  let box: Renderable | undefined
  const [width, setWidth] = createSignal(NARROW_AT)
  const narrow = () => width() < NARROW_AT
  return (
    <box
      flexDirection="row"
      flexGrow={1}
      minWidth={0}
      width="100%"
      ref={(element: Renderable) => {
        box = element
        setWidth(element.parent?.width ?? element.width)
      }}
      onSizeChange={() => setWidth(box?.parent?.width ?? box?.width ?? NARROW_AT)}
    >
      {/* Both forms draw the same two columns: the list in `list`, or the first of the `split` form's
          children (a `ListColumn` beside a `DetailColumn`). With neither there is no list to draw,
          and no empty 32-cell gutter for one (docs/tui.md). Below 80 cells the two stack instead of
          sitting side by side. */}
      <Show
        when={listSide() !== undefined}
        fallback={
          <box flexDirection={narrow() ? 'column' : 'row'} flexGrow={1}>
            {columns()}
          </box>
        }
      >
        <box flexDirection={narrow() ? 'column' : 'row'} flexGrow={1} minWidth={0}>
          <box
            flexDirection="column"
            width={narrow() ? '100%' : LIST_CELLS[props.listWidth ?? 'default']}
            height={narrow() ? 12 : undefined}
            flexShrink={0}
            minWidth={0}
            ref={paneId ? regionFocus({ paneId, regionId: 'list' }, 0) : undefined}
          >
            {listSide()}
          </box>
          {/* The divider runs the columns' full height, as the DOM's 1px middle track does. */}
          <Show when={!narrow()}>
            <Rule axis="y" />
          </Show>
          <box
            flexDirection="column"
            flexGrow={1}
            minWidth={0}
            ref={paneId ? regionFocus({ paneId, regionId: 'detail' }, 1) : undefined}
          >
            {detailSide()}
          </box>
        </box>
      </Show>
    </box>
  )
}

/** reduced: the left column, or the whole width when the split has collapsed. The width is the
 *  parent's; this node draws the scroll.
 *
 *  The column always scrolls, because the DOM's does (`.ui-listdetail-list` is `overflow-y: auto`): a
 *  column of 200 rows scrolls its own rows rather than pushing the pane taller. A list with a viewport
 *  of its own still owns its scrolling, because a viewport takes the room left over rather than the
 *  room its content wants (../scrolling.tsx), so this one never has anything to move. `scroll` is the
 *  DOM's padding choice and changes nothing here.
 *
 *  `label` is not drawn. On the DOM it is the column's accessible name and nothing on screen, so a
 *  caller that wants a visible heading writes a `SectionHeader`, and drawing the label as well showed
 *  the name twice. `scrollKey` is ignored: this host keeps no scroll position for a column that is
 *  drawn again. */
export function ListColumn(props: { label?: string; scroll?: boolean; scrollKey?: string; children: JSX.Element }) {
  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <ScrollViewport>{props.children}</ScrollViewport>
    </box>
  )
}

/** `measure` is ignored: a terminal column is already as narrow as a line anyone reads. */
export function DetailColumn(props: { scroll?: boolean; measure?: 'page'; children: JSX.Element }) {
  return (
    <box flexDirection="column" flexGrow={1}>
      {props.scroll ? <ScrollViewport>{props.children}</ScrollViewport> : props.children}
    </box>
  )
}

/** absent: a terminal split moves by a key, not a grip. Nothing is drawn and nothing is a stop. */
export const SplitHandle = (_props: { axis: 'x' | 'y'; drag: unknown }) => null
