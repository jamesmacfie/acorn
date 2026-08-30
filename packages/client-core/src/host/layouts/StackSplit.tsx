import { createSplitDrag } from '../../kit/lib/split'
import { layoutState } from './state'
// Imported for `use:regionFocus` below: Solid compiles a directive to a bare reference, so the
// import has to be here even though nothing calls it.
// eslint-disable-next-line no-unused-vars -- used by the `use:regionFocus` directive.
import { regionFocus } from '../keys/regions'
import type { LayoutProps } from './regions'

// `stack-split`: `top` over `bottom`, with a host-owned handle between them. Two focus groups.
//
// The terminal drawer is the consumer this was drawn from, which is why `bottom` is the region that
// carries a height and `top` takes what is left.
//
// Narrow: `bottom` becomes a full-height sheet. Terminal: the same as desktop, drawn natively.

const DEFAULT_BOTTOM_HEIGHT = 200
const MIN_BOTTOM_HEIGHT = 64
const MAX_BOTTOM_FRACTION = 0.8

export function StackSplit(props: LayoutProps) {
  const [height, setHeight] = layoutState(props.stateKey, 'bottom-height', DEFAULT_BOTTOM_HEIGHT)
  let dragStart: number | null = null
  const drag = createSplitDrag({
    axis: 'y',
    // Dragging the handle down shrinks `bottom`, so the arrow keys have to run the other way.
    invert: true,
    label: `Resize ${props.label}`,
    onStart: () => { dragStart = height() },
    onDelta: (deltaPx) =>
      setHeight(Math.min(Math.max((dragStart ?? height()) - deltaPx, MIN_BOTTOM_HEIGHT), window.innerHeight * MAX_BOTTOM_FRACTION)),
    onCommit: () => { dragStart = null },
  })

  return (
    <div class="pane layout-stack-split">
      <div class="layout-region-top" use:regionFocus={{ paneId: props.stateKey, regionId: 'top' }}>{props.regions.top?.()}</div>
      <div {...drag.handleProps} class="ui-split-handle" data-axis="y" />
      <div class="layout-region-bottom" style={{ height: `${height()}px` }} use:regionFocus={{ paneId: props.stateKey, regionId: 'bottom' }}>{props.regions.bottom?.()}</div>
    </div>
  )
}
