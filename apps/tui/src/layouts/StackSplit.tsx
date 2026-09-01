/** @jsxImportSource @opentui/solid */
import { createSignal } from 'solid-js'
import type { BoxRenderable } from '@opentui/core'
import type { LayoutProps } from '@acorn/client-core/host/layouts/regions.ts'
import { createKeySplit } from './split'
import { Panel } from '../panel'
import { regionFocus } from '../keys/regions'

// `stack-split`: `top` over `bottom` with a rule between them, the split moved by a key. Its
// projection is "native, as on desktop" (docs/panes.md § Layout model), and this is what that is in
// cells: two blocks, a divider line, and no grip.
//
// `bottom` carries the height and `top` takes what is left, which is the shape the terminal drawer
// was drawn from — the region you resize is the one you are looking at.

const DEFAULT_BOTTOM_LINES = 10
const MIN_BOTTOM_LINES = 3
const MAX_BOTTOM_FRACTION = 0.8

export function StackSplit(props: LayoutProps) {
  let box: BoxRenderable | undefined
  const [lines, setLines] = createSignal(0)
  const split = createKeySplit({
    stateKey: props.stateKey,
    name: 'bottom-height',
    axis: 'y',
    initial: DEFAULT_BOTTOM_LINES,
    min: MIN_BOTTOM_LINES,
    // This layout's own box, never the terminal's height. The rule is the same one the DOM layout
    // keeps with `offsetHeight` (docs/ui-design.md § What the kit and layouts must never do).
    ceiling: () => Math.floor(lines() * MAX_BOTTOM_FRACTION),
  })

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      ref={(element: BoxRenderable) => {
        box = element
        setLines(element.height)
        split.attach(element)
      }}
      onSizeChange={() => setLines(box?.height ?? 0)}
    >
      {/* Each region's border carries its own name rather than the pane's: this layout has two, and
          which one has the keys is the thing a reader needs to know. The rule that used to sit
          between them is gone — two frames already meet there, and a rule beside a border is two
          lines saying one thing (../panel.tsx). */}
      <Panel grow title="Top" onBox={regionFocus({ paneId: props.stateKey, regionId: 'top' }, 0)}>
        {props.regions.top?.()}
      </Panel>
      <Panel rows={split.size()} title="Bottom" onBox={regionFocus({ paneId: props.stateKey, regionId: 'bottom' }, 1)}>
        {props.regions.bottom?.()}
      </Panel>
    </box>
  )
}
