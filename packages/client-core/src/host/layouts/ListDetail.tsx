import { Show } from 'solid-js'
import { paneCollapseKey, sidebarCollapse } from '../../kit/lib/collapseState'
import { Button } from '../../kit/components/primitives'
import Icon from '../../kit/components/content/Icon'
import { createSplitDrag } from '../../kit/lib/split'
import { layoutState } from './state'
// Imported for `use:regionFocus` below: Solid compiles a directive to a bare reference, so the
// import has to be here even though nothing calls it.
// eslint-disable-next-line no-unused-vars -- used by the `use:regionFocus` directive.
import { regionFocus } from '../keys/focusRegions'
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
// Collapsing is the other answer to the same question, and the column survives it: it narrows to the
// width of the icon rails and each row keeps one mark. Every pane that names this layout gets the
// control, with no field on the contribution, because a pane that names `list-detail` is a sidebar by
// definition. The kit node has to be told (kit/components/primitives.tsx § ListDetail) since it also
// draws splits that are two halves of one document.
//
// The regions are left alone while collapsed. A pane's `list-header` is the pane's own, so whether it
// becomes one icon or nothing at all is a question only the pane can answer, and it answers it by
// reading the same signal this does (kit/lib/collapseState.ts).
//
// Narrow: one region at a time, and selecting in the list pushes the detail. Terminal: the same below
// 80 columns, two columns above it, with a key to switch groups.

// The list's width in pixels, once someone has dragged it. Zero means "whatever --listdetail-w says",
// which is a clamp against the viewport rather than a number, so the default cannot be written here.
const MIN_LIST_WIDTH = 120
const MAX_LIST_FRACTION = 0.6

export function ListDetail(props: LayoutProps) {
  const [width, setWidth] = layoutState(props.stateKey, 'list-width', 0)
  const [stored, setCollapsed] = sidebarCollapse(paneCollapseKey(props.stateKey))
  // A pane that never offered the control must not come back collapsed because it once did, or a
  // stored flag from an earlier build leaves a rail nobody can widen.
  const collapsed = () => props.collapsible === true && stored()
  let root: HTMLDivElement | undefined
  let list: HTMLElement | undefined
  // Snapshotted at pointer-down, so a keyboard nudge measures from the width on screen rather than
  // from the last drag's start.
  let dragStart: number | null = null
  // The ceiling is this layout's own box, never the window. A pane is one column of a task row, so the
  // window is not what its list is allowed to fill, and no layout may read the window's width
  // (shell.css § Layouts, docs/ui-design.md § What the kit and layouts must never do, "never do these" item 12). Before
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
    <div ref={root} class="pane layout-list-detail" style={width() && !collapsed() ? { '--listdetail-w': `${width()}px` } : undefined}>
      <Show when={!props.hidden?.includes('list')}>
        {/* <aside> rather than a div: the list is a complementary landmark, and naming it is how a
            screen reader tells two same-shaped columns apart. */}
        <aside ref={list} class="layout-region-list" data-collapsed={collapsed() ? '' : undefined} aria-label={`${props.label} list`} use:regionFocus={{ paneId: props.stateKey, regionId: 'list' }}>
          {props.regions['list-header']?.()}
          <div class="layout-list-scroll">{props.regions.list?.()}</div>
          {props.regions['list-footer']?.()}
        </aside>
        {/* The divider, and the collapse control riding on it. On the edge rather than in the list's
            header because the header is a region the pane wrote, and because a collapsed column has
            no header left to put a button in. A rail cannot be dragged wider, so the grip goes. */}
        <div class="layout-list-edge" data-collapsed={collapsed() ? '' : undefined}>
          <Show when={!collapsed()}>
            <div {...drag.handleProps} class="ui-split-handle" data-axis="x" />
          </Show>
          <Show when={props.collapsible}>
            <Button
              variant="bare"
              size="xs"
              iconOnly
              label={collapsed() ? `Expand ${props.label} list` : `Collapse ${props.label} list`}
              tip={collapsed() ? 'Expand list' : 'Collapse list'}
              onPress={() => setCollapsed(!collapsed())}
            >
              <Icon name={collapsed() ? 'chevron-right' : 'chevron-left'} />
            </Button>
          </Show>
        </div>
      </Show>
      <div class="layout-region-detail" use:regionFocus={{ paneId: props.stateKey, regionId: 'detail' }}>{props.regions.detail?.()}</div>
    </div>
  )
}
