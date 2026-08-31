/** @jsxImportSource @opentui/solid */
import { createSignal, Show } from 'solid-js'
import type { BoxRenderable } from '@opentui/core'
import type { LayoutProps } from '@acorn/client-core/host/layouts/regions.ts'
import { Rule } from '../kit/cells'
import { bindKeys } from '../keys/install'
import { regionFocus } from '../keys/regions'
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

export function ListDetail(props: LayoutProps) {
  let box: BoxRenderable | undefined
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
      ref={(element: BoxRenderable) => {
        box = element
        setWidth(element.width)
        split.attach(element)
        // The narrow group switch, on the pane's own tier. `expand` and `collapse` are `l` and `h`
        // and the horizontal arrows; both switch, because a narrow `list-detail` has two halves and
        // no third place to go. A wide one refuses and the intent bubbles.
        bindKeys(element, [...['left', 'h'], ...['right', 'l']].map((key) => ({
          key,
          cmd: () => {
            if (!narrow()) return false
            setGroup((half) => (half === 'list' ? 'detail' : 'list'))
            return true
          },
        })), 30)
      }}
      onSizeChange={() => setWidth(box?.width ?? NARROW_AT)}
    >
      <Show when={showList()}>
        <box
          flexDirection="column"
          width={narrow() ? undefined : split.size()}
          flexGrow={narrow() ? 1 : 0}
          ref={regionFocus({ paneId: props.stateKey, regionId: 'list' }, 0)}
        >
          {props.regions['list-header']?.()}
          <box flexDirection="column" flexGrow={1} overflow="scroll">{props.regions.list?.()}</box>
          {props.regions['list-footer']?.()}
        </box>
      </Show>
      <Show when={showList() && showDetail()}><Rule axis="y" /></Show>
      <Show when={showDetail()}>
        <box flexDirection="column" flexGrow={1} ref={regionFocus({ paneId: props.stateKey, regionId: 'detail' }, 1)}>
          {props.regions.detail?.()}
        </box>
      </Show>
    </box>
  )
}
