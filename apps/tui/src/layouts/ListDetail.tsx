/** @jsxImportSource @opentui/solid */
import { createSignal, Show } from 'solid-js'
import type { BoxRenderable } from '@opentui/core'
import type { LayoutProps } from '@acorn/client-core/host/layouts/regions.ts'
import { registerGroupSwitch } from './state'

// `list-detail` in cells, from its written projection (docs/panes.md § Layout model): two columns
// above 80 cells, one at a time below it, and a key to switch groups.
//
// `LayoutProps` and `Region` are already host-neutral — a region is a thunk that returns JSX — so
// nothing about this file's contract differs from the DOM layout's. What differs is the mechanism:
// the divider is a column of `│`, the split moves by a key rather than a drag, and the ceiling is
// asked of this box rather than of the terminal. No layout may read the terminal's width; a layout
// asks its own region how wide it turned out, which is the same rule the DOM layout keeps with
// `offsetWidth`.

const NARROW_AT = 80
// Fixed in phase 0. The projection says the split position is a session signal that moves by a key,
// and `client-core/host/layouts/state.ts` already holds one host-neutrally; what it does not have is a
// key, because `expand` and `collapse` are spent on the narrow group switch below. Phase 2 decides.
const LIST_CELLS = 32

export function ListDetail(props: LayoutProps) {
  let box: BoxRenderable | undefined
  const [width, setWidth] = createSignal(NARROW_AT)
  // Which half the keys are in while narrow. Above 80 cells both are drawn and the switch refuses, so
  // the intent bubbles instead of moving something nobody can see.
  const [group, setGroup] = createSignal<'list' | 'detail'>('list')
  const narrow = () => width() < NARROW_AT
  registerGroupSwitch(() => {
    if (!narrow()) return false
    setGroup((half) => (half === 'list' ? 'detail' : 'list'))
    return true
  })
  const showList = () => !props.hidden?.includes('list') && (!narrow() || group() === 'list')
  const showDetail = () => !narrow() || group() === 'detail'

  return (
    <box
      flexDirection="row"
      flexGrow={1}
      ref={(element: BoxRenderable) => { box = element; setWidth(element.width) }}
      onSizeChange={() => setWidth(box?.width ?? NARROW_AT)}
    >
      <Show when={showList()}>
        <box flexDirection="column" width={narrow() ? undefined : LIST_CELLS} flexGrow={narrow() ? 1 : 0}>
          {props.regions['list-header']?.()}
          <box flexDirection="column" flexGrow={1} overflow="scroll">{props.regions.list?.()}</box>
          {props.regions['list-footer']?.()}
        </box>
      </Show>
      <Show when={showList() && showDetail()}>
        <box width={1} flexDirection="column"><text>│</text></box>
      </Show>
      <Show when={showDetail()}>
        <box flexDirection="column" flexGrow={1}>{props.regions.detail?.()}</box>
      </Show>
    </box>
  )
}
