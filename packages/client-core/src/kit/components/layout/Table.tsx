import type { JSX } from 'solid-js'

/* Table: real <table> semantics, token styling, and a horizontal-scroll wrapper. No column defs,
   no sorting, no virtualization; a consumer that needs sorting can grow a `Table.SortHeader`.

   Not for the virtualized grids (.diff-row, .dbgrid-row), which are measured geometry, the same
   reason Row excludes them. */
export function Table(props: {
  size?: 'sm' | 'md'
  stickyHead?: boolean
  /** Sets the h-scroll floor. Without it a wide table forces the whole pane to scroll sideways. */
  minWidth?: number
  children: JSX.Element
}) {
  return (
    <div class="ui-table-scroll" data-scroll={props.minWidth ? '' : undefined}>
      <table
        class="ui-table"
        data-size={props.size ?? 'md'}
        data-sticky={props.stickyHead ? '' : undefined}
        style={props.minWidth ? { 'min-width': `${props.minWidth}px` } : undefined}
      >
        {props.children}
      </table>
    </div>
  )
}

/* Table's own rows. Before these, every caller wrote the `<thead>`/`<tr>`/`<td>` markup the closed
   kit forbids everywhere else, and the support matrix promised a terminal rendering — box-drawn,
   truncating columns — that no host could keep over DOM it cannot see.

   `children` stays `JSX.Element`: Solid types every JSX expression as `JSX.Element`, so a type that
   said "rows only" would be a lie the compiler cannot check. The rule is the kit-purity arch test
   in tools/arch/boundaries.test.ts. */

/** Where a cell's content sits in its column. A role, not a length. */
type CellAlign = 'start' | 'center' | 'end'

/** Which columns survive on a host too narrow to draw them all: the lowest goes first. The DOM host
 *  ignores it and scrolls sideways instead; a terminal host must not, because the choice of what to
 *  lose belongs to the author, the same rule the layouts follow. */
type ColumnPriority = 'high' | 'normal' | 'low'

/** One column's label. Lives in a `TableRow head`. */
export function TableHead(props: { align?: CellAlign; priority?: ColumnPriority; children?: JSX.Element }) {
  return <th scope="col" data-align={props.align} data-priority={props.priority}>{props.children}</th>
}

/** One row. `head` puts it in the `<thead>`, which is what `Table`'s `stickyHead` pins.
 *
 *  `onPress` is here rather than left to the caller because a table whose rows open something was
 *  clickable by mouse and by nothing else at all three call sites: `Row` gives a list its keyboard,
 *  and a table cell cannot be a `Row`. */
export function TableRow(props: { head?: boolean; onPress?: () => void; children: JSX.Element }) {
  const row = () => (
    <tr
      role={props.onPress ? 'button' : undefined}
      tabindex={props.onPress ? 0 : undefined}
      onClick={() => props.onPress?.()}
      onKeyDown={(event) => {
        if (!props.onPress) return
        // A press inside a cell's own control is that control's, not the row's.
        if (event.target !== event.currentTarget) return
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        props.onPress()
      }}
    >{props.children}</tr>
  )
  // Read once: `head` says which half of the table a row belongs to, and no caller moves a row
  // between them.
  return props.head ? <thead>{row()}</thead> : row()
}

/** One cell. `header` makes it the row's own label rather than a value. */
export function TableCell(props: { align?: CellAlign; header?: boolean; children?: JSX.Element }) {
  return props.header
    ? <th scope="row" data-align={props.align}>{props.children}</th>
    : <td data-align={props.align}>{props.children}</td>
}
