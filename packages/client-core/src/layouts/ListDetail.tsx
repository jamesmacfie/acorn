import { Show } from 'solid-js'
import { createSplitDrag } from '../ui/split'
import { layoutState } from './state'
// Imported for `use:regionFocus` below: Solid compiles a directive to a bare reference, so the
// import has to be here even though nothing calls it.
// eslint-disable-next-line no-unused-vars -- used by the `use:regionFocus` directive.
import { regionFocus } from '../keys/regions'
import type { LayoutProps } from './regions'

// `list-detail`: a list beside a detail, with the host drawing the divider and the drag handle.
//
// Regions: `list`, `detail`, and optionally `list-header` and `list-footer`, which pin above and below
// the list's own scroll. Two focus groups from phase 2, `list` and `detail`.
//
// Hiding `list` drops the whole column, its header and footer with it, and the detail takes the width.
// That is what a pane collapsing its library asks for, and it is the same move the narrow projection
// makes on every selection.
//
// Narrow: one region at a time, and selecting in the list pushes the detail. Terminal: the same below
// 80 columns, two columns above it, with a key to switch groups.

// The list's width in pixels, once someone has dragged it. Zero means "whatever --listdetail-w says",
// which is a clamp against the viewport rather than a number, so the default cannot be written here.
const MIN_LIST_WIDTH = 120
const MAX_LIST_FRACTION = 0.6

export function ListDetail(props: LayoutProps) {
  const [width, setWidth] = layoutState(props.stateKey, 'list-width', 0)
  let root: HTMLDivElement | undefined
  let list: HTMLElement | undefined
  // Snapshotted at pointer-down, so a keyboard nudge measures from the width on screen rather than
  // from the last drag's start.
  let dragStart: number | null = null
  // The ceiling is this layout's own box, never the window. A pane is one column of a task row, so the
  // window is not what its list is allowed to fill, and no layout may read the window's width
  // (shell.css § Layouts, docs/future/layout/09-doors-left-open.md, "never do these" item 12). Before
  // the element is measurable there is no ceiling to apply; the floor still holds.
  const ceiling = () => {
    const extent = root?.offsetWidth ?? 0
    return extent > 0 ? extent * MAX_LIST_FRACTION : Number.POSITIVE_INFINITY
  }
  const drag = createSplitDrag({
    axis: 'x',
    label: `Resize ${props.label} list`,
    onStart: () => { dragStart = width() || (list?.offsetWidth ?? MIN_LIST_WIDTH) },
    onDelta: (deltaPx) => {
      const from = dragStart ?? (width() || (list?.offsetWidth ?? MIN_LIST_WIDTH))
      setWidth(Math.min(Math.max(from + deltaPx, MIN_LIST_WIDTH), ceiling()))
    },
    onCommit: () => { dragStart = null },
  })

  return (
    <div ref={root} class="pane layout-list-detail" style={width() ? { '--listdetail-w': `${width()}px` } : undefined}>
      <Show when={!props.hidden?.includes('list')}>
        {/* <aside> rather than a div: the list is a complementary landmark, and naming it is how a
            screen reader tells two same-shaped columns apart. */}
        <aside ref={list} class="layout-region-list" aria-label={`${props.label} list`} use:regionFocus={{ paneId: props.stateKey, regionId: 'list' }}>
          {props.regions['list-header']?.()}
          <div class="layout-list-scroll">{props.regions.list?.()}</div>
          {props.regions['list-footer']?.()}
        </aside>
        <div {...drag.handleProps} class="ui-split-handle" data-axis="x" />
      </Show>
      <div class="layout-region-detail" use:regionFocus={{ paneId: props.stateKey, regionId: 'detail' }}>{props.regions.detail?.()}</div>
    </div>
  )
}
