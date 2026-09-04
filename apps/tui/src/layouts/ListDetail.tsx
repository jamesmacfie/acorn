/** @jsxImportSource @acorn/tui/jsx */
import { createSignal, Show } from 'solid-js'
import type { Renderable } from '../tree/compat'
import type { LayoutProps } from '@acorn/client-core/host/layouts/regions.ts'
import { Panel } from '../panel'
import { ScrollViewport } from '../kit/scrolling'
import { bindKeys } from '../keys/install'
import { regionFocus } from '../keys/regions'
import { PANE } from '../keys/tiers'
import { createKeySplit } from './split'

// `list-detail` in cells, from its written projection (docs/panes.md § Layout model): two columns
// above 80 cells, one at a time below it, and a key to switch groups.
//
// `LayoutProps` and `Region` are already host-neutral — a region is a thunk that returns JSX — so
// nothing about this file's contract differs from the DOM layout's. What differs is the mechanism:
// the divider is a column of cells, the split moves by a key rather than a drag, and the ceiling is
// asked of this box rather than of the terminal. No layout may read the terminal's width; a layout
// asks its own region how wide it turned out, which is the same rule the DOM layout keeps with
// `offsetWidth`.

const NARROW_AT = 80
const DEFAULT_LIST_CELLS = 32
const MIN_LIST_CELLS = 12
const MAX_LIST_FRACTION = 0.6

/** The two columns this layout draws, so Right crosses from the list to the detail rather than
 *  bubbling past both to the rail.
 *
 *  Declared unconditionally rather than gated on `narrow()`, which is the obvious question. When
 *  narrow the layout draws one half at a time, so whichever region is not showing is not mounted and
 *  registers nothing: there is no first column in the pane for a cross out of the detail to find,
 *  which is the honest answer, because the list is not on screen. And the group switch below claims
 *  `h` and `l` at the pane's own tier while narrow anyway, above the region tier that would move a
 *  column (../keys/regions.ts § moveColumn). */
const LIST_COLUMN = 1
const DETAIL_COLUMN = 2

export function ListDetail(props: LayoutProps) {
  let box: Renderable | undefined
  const [width, setWidth] = createSignal(NARROW_AT)
  // Which half the keys are in while narrow. Above 80 cells both are drawn and the switch refuses, so
  // the intent bubbles instead of moving something nobody can see.
  const [group, setGroup] = createSignal<'list' | 'detail'>('list')
  const narrow = () => width() < NARROW_AT
  const split = createKeySplit({
    stateKey: props.stateKey,
    name: 'list-width',
    axis: 'x',
    initial: DEFAULT_LIST_CELLS,
    min: MIN_LIST_CELLS,
    ceiling: () => Math.floor(width() * MAX_LIST_FRACTION),
  })
  const showList = () => !props.hidden?.includes('list') && (!narrow() || group() === 'list')
  const showDetail = () => !narrow() || group() === 'detail'

  return (
    <box
      flexDirection="row"
      flexGrow={1}
      ref={(element: Renderable) => {
        box = element
        setWidth(element.width)
        split.attach(element)
        // The narrow group switch, on the pane's own tier, which is above the region tier that moves
        // a column. `expand` and `collapse` are `l` and `h` and the horizontal arrows; both switch,
        // because a narrow `list-detail` has two halves and no third place to go. A wide one refuses
        // and the intent bubbles to the column move, which is what crosses the two frames that are
        // actually side by side (../keys/tiers.ts, ../keys/regions.ts § moveColumn).
        bindKeys(element, [...['left', 'h'], ...['right', 'l']].map((key) => ({
          key,
          cmd: () => {
            if (!narrow()) return false
            setGroup((half) => (half === 'list' ? 'detail' : 'list'))
            return true
          },
        })), PANE)
      }}
      onSizeChange={() => setWidth(box?.width ?? NARROW_AT)}
    >
      {/* Two named frames and no rule between them: the columns' borders already meet there
          (../panel.tsx). The header and footer strips stay inside the list's frame, where they were,
          because they are the list's own chrome and not regions a reader moves to. */}
      <Show when={showList()}>
        <box
          flexDirection="column"
          width={narrow() ? undefined : split.size()}
          flexGrow={narrow() ? 1 : 0}
        >
          <Panel grow title="List" onBox={regionFocus({ paneId: props.stateKey, regionId: 'list' }, 0, { x: LIST_COLUMN })}>
            {props.regions['list-header']?.()}
            {/* A real viewport, where this was a yoga clip. A clip hides the rows below the fold and
                owns no offset for the caret's reveal to move, so `j` past the twentieth row of a
                thirty-row list walked the caret off the screen. Round the list region only, not the
                header and footer strips: those are the list's own chrome and do not scroll with it
                (../kit/scrolling.tsx, docs/tui.md § Scrolling viewports). */}
            <ScrollViewport>{props.regions.list?.()}</ScrollViewport>
            {props.regions['list-footer']?.()}
          </Panel>
        </box>
      </Show>
      <Show when={showDetail()}>
        {/* `minWidth={0}`, because a flex child's floor is its own content and a detail region's content
            is routinely wider than its share. Without it the row reports a width the screen does not
            have (docs/tui.md). */}
        <box flexDirection="column" flexGrow={1} minWidth={0}>
          <Panel grow scroll title="Detail" onBox={regionFocus({ paneId: props.stateKey, regionId: 'detail' }, 1, { x: DETAIL_COLUMN })}>
            {props.regions.detail?.()}
          </Panel>
        </box>
      </Show>
    </box>
  )
}
