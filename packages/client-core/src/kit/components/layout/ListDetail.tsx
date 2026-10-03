import { children, createSignal, Show, type JSX } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { sidebarCollapse } from '../../lib/layout/collapseState'
import { createSplitDrag, type SplitDrag } from '../../lib/layout/split'
import Icon from '../content/Icon'
import { Button } from '../inputs/Button'

/* SplitHandle: the drag-resize grip. Behaviour lives in createSplitDrag (../../lib/layout/split.ts); this is the
   markup, a wide hit area around a hairline. */
export function SplitHandle(props: { axis: 'x' | 'y'; drag: SplitDrag }) {
  // A remote tree may name a kit node without being able to supply this host-minted drag handle.
  // The wire drops `drag`; keep such a node inert rather than throwing during host render.
  if (!props.drag) return null
  return <div {...props.drag.handleProps} class="ui-split-handle" data-axis={props.axis} />
}

/* CollapseEdge: the divider between a sidebar and its detail, with the control that collapses the
   sidebar to a rail riding on it.

   The control sits on the edge rather than in the list column's header, because the header belongs
   to whoever wrote the column, and because a collapsed column is a rail with no header left to put
   a button in. A collapsed column also loses the drag handle, along with the width it could have
   been dragged to.

   One node for both sidebars. The kit's `ListDetail` below and the host's `list-detail` layout
   (host/layouts/ListDetail.tsx) draw the same edge, and while they each wrote their own the two
   buttons drifted: one grew a border and the other never had one. */
export function CollapseEdge(props: {
  collapsed: boolean
  onToggle: () => void
  drag: SplitDrag
  /** Which list, for the accessible name: "Collapse Pull requests list". The tooltip stays plain,
   *  since whoever can see it can also see which column it is on. */
  listLabel?: string
}) {
  const verb = () => props.collapsed ? 'Expand' : 'Collapse'
  return (
    <div class="ui-listdetail-edge" data-collapsed={props.collapsed ? '' : undefined}>
      <Show when={!props.collapsed}><SplitHandle axis="x" drag={props.drag} /></Show>
      <Button
        variant="bare"
        size="xs"
        iconOnly
        label={`${verb()} ${props.listLabel ? `${props.listLabel} ` : ''}list`}
        tip={`${verb()} list`}
        onPress={() => props.onToggle()}
      >
        <Icon name={props.collapsed ? 'chevron-right' : 'chevron-left'} />
      </Button>
    </div>
  )
}

/* ListDetail: list beside detail. See docs/ui-design/two-column-panes.md § Two-column panes for what it replaces,
   the layout rules, and when not to use it. */
const MIN_LIST_DETAIL_WIDTH = 120
const MAX_LIST_DETAIL_FRACTION = 0.6

export function ListDetail(props: {
  list?: JSX.Element
  /** Two columns given as `ListColumn` and `DetailColumn` children instead of through `list`. */
  split?: boolean
  /** aria-label for the list column. It is a landmark; name it. */
  listLabel?: string
  /** `narrow` is the compact identifier switcher, `default` is the browse list, and `wide` is a
   *  column that holds a document rather than a picker. */
  listWidth?: 'narrow' | 'default' | 'wide'
  /** Detail column scrolls as one region. Otherwise its children own their scrolling. */
  scrollDetail?: boolean
  /** `main` when this split is the document itself, such as a plugin frame where nothing else
   *  claims the landmark. A pane inside the shell leaves it a div, because the shell owns the
   *  page's `main`. */
  detailAs?: 'div' | 'main'
  /** This split's list column is a sidebar: offer the control that narrows it to the width of the
   *  icon rails, and remember the answer under this key (../../lib/layout/collapseState.ts).
   *
   *  Opt in, because this node also draws splits that are two halves of one document. A pull
   *  request's section nav has no rail form, so Sections closes the column to its edge. The host's
   *  `list-detail` *layout* needs no such flag, since a pane that names that layout is a sidebar by
   *  definition (host/layouts/ListDetail.tsx).
   *
   *  The rows collapse separately, from the same signal: read it with `sidebarCollapsed(key)` and
   *  pass each row a `collapsed` slot. */
  collapseKey?: string
  /** `edge` removes the list column's width when collapsed, while leaving the shared toggle on the
   *  divider. Use it when the column has no useful rail form. */
  collapseTo?: 'rail' | 'edge'
  /** Hide list contents in a collapsed rail while keeping them mounted. */
  collapseContent?: 'rows' | 'empty'
  children: JSX.Element
}) {
  // `list` is a prop, so every read of it re-runs the JSX the caller wrote there. This read it three
  // times, for the width attribute, the Show and the insert, so the column was built three times
  // over and two of those copies stayed off screen with their effects still running. Docker's
  // column came out empty, because the three copies fought over the same nodes. `children()`
  // resolves the prop once and hands the same nodes to all three readers.
  const list = children(() => props.list)
  const columns = children(() => props.children)
  const [width, setWidth] = createSignal(0)
  const collapse = () => props.collapseKey === undefined ? undefined : sidebarCollapse(props.collapseKey)
  const collapsed = () => collapse()?.[0]() === true
  let root: HTMLDivElement | undefined
  let dragStart: number | null = null
  const currentListWidth = () => {
    const first = root?.firstElementChild
    return width() || (first instanceof HTMLElement ? first.offsetWidth : 0) || MIN_LIST_DETAIL_WIDTH
  }
  // Clamp to this split, not the window: ListDetail is also nested inside detail columns (Rollbar
  // and GitHub), and each nesting level owns only the room its parent gave it.
  const ceiling = () => {
    const extent = root?.offsetWidth ?? 0
    return extent > 0 ? extent * MAX_LIST_DETAIL_FRACTION : Number.POSITIVE_INFINITY
  }
  const drag = createSplitDrag({
    axis: 'x',
    label: 'Resize list',
    onStart: () => { dragStart = currentListWidth() },
    onDelta: (deltaPx) => {
      const from = dragStart ?? currentListWidth()
      setWidth(Math.min(Math.max(from + deltaPx, MIN_LIST_DETAIL_WIDTH), ceiling()))
    },
    onCommit: () => { dragStart = null },
  })
  // A split with no collapse is the bare handle it always was, and the edge above appears only where
  // there is a second thing to hold. Most of this node's callers are two halves of a document rather
  // than a sidebar, and the grid's middle track is a contract they already keep.
  const edge = () => (
    <Show when={props.collapseKey !== undefined} fallback={<SplitHandle axis="x" drag={drag} />}>
      <CollapseEdge collapsed={collapsed()} onToggle={() => collapse()?.[1](!collapsed())} drag={drag} listLabel={props.listLabel} />
    </Show>
  )
  return (
    <div
      ref={root}
      class="ui-listdetail"
      data-list={list() !== undefined || props.split ? (collapsed() ? 'collapsed' : (props.listWidth ?? 'default')) : undefined}
      data-collapse-to={props.collapseTo}
      style={width() && !collapsed() ? { 'grid-template-columns': `${width()}px 1px minmax(0, 1fr)` } : undefined}
    >
      <Show
        when={list() !== undefined}
        fallback={
          <Show when={props.split} fallback={columns()}>
            {columns.toArray()[0]}
            {edge()}
            {columns.toArray().slice(1)}
          </Show>
        }
      >
        <>
          {/* <aside> rather than a div: the list is a complementary landmark, and naming it is how a
              screen reader tells two same-shaped columns apart. */}
          <aside
            class="ui-listdetail-list"
            aria-label={props.listLabel}
            style={collapsed() && props.collapseContent === 'empty' ? { visibility: 'hidden' } : undefined}
          >
            {list()}
          </aside>
          {edge()}
          <Dynamic
            component={props.detailAs === 'main' ? 'main' : 'div'}
            class="ui-listdetail-detail"
            data-scroll={props.scrollDetail ? '' : undefined}
          >
            {columns()}
          </Dynamic>
        </>
      </Show>
    </div>
  )
}

/* The two columns as nodes of their own, for a caller that cannot put an element in a prop.
   A remote tree is exactly that caller: its props are JSON on a message port, so `list` above is
   unreachable from a sandbox and the split has to be expressible as children
   (docs/plugins/tree-contract.md § The tree contract).

   `split` on ListDetail is what turns the grid on in that form, because the parent can no longer tell
   from `list` whether there are two columns.

   At 80×24: as ListDetail. */
export function ListColumn(props: {
  label?: string
  /** This column is a document rather than a list: it scrolls as one region and takes the pane's
   *  inline padding. A column of rows leaves it unset — its rows own their scrolling and sit flush
   *  against the divider, which is what every list in the app does. */
  scroll?: boolean
  children: JSX.Element
}) {
  return (
    <aside class="ui-listdetail-list" data-scroll={props.scroll ? '' : undefined} aria-label={props.label}>
      {props.children}
    </aside>
  )
}

export function DetailColumn(props: {
  scroll?: boolean
  /** `page` caps the column's content at a settings page's width, from its start edge, for a detail
   *  that is a form or a document rather than a canvas. Chrome still spans the column. */
  measure?: 'page'
  children: JSX.Element
}) {
  return (
    <div class="ui-listdetail-detail" data-scroll={props.scroll ? '' : undefined} data-measure={props.measure}>
      {props.children}
    </div>
  )
}
