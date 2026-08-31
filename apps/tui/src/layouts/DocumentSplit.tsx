/** @jsxImportSource @opentui/solid */
import { createSignal } from 'solid-js'
import type { BoxRenderable } from '@opentui/core'
import type { LayoutProps } from '@acorn/client-core/host/layouts/regions.ts'
import { Rule } from '../kit/cells'
import { createKeySplit } from './split'
import { regionFocus } from '../keys/regions'

// `document-over-frame` and `frame-beside-document`: a host-owned editor and a plugin's region, with
// the split moved by a key rather than dragged.
//
// The written projection said the frame half is absent in a terminal and the document half fills the
// pane. That was drawn before the `editor` rectangle existed and before it was clear what a `frame`
// region actually holds here: a frame is a *loaded plugin's* tree, and a tree draws in cells like any
// other (docs/plugins.md § Descriptors for facts, trees for UI, rectangles for pixels). What cannot
// cross is an iframe's pixels, and a frame region is not one. So both halves are drawn, and the
// projection in docs/panes.md now says so.
//
// One component and two names, because the axis is in the name and never in a prop
// (docs/panes.md § Layout model, on adding a ninth).

const DEFAULT_DOCUMENT = 10
const MIN_DOCUMENT = 3
const MAX_DOCUMENT_FRACTION = 0.7

const documentSplit = (axis: 'x' | 'y') => (props: LayoutProps) => {
  let box: BoxRenderable | undefined
  const [extent, setExtent] = createSignal(0)
  const split = createKeySplit({
    stateKey: props.stateKey,
    name: 'document-size',
    axis,
    initial: axis === 'x' ? DEFAULT_DOCUMENT * 3 : DEFAULT_DOCUMENT,
    min: MIN_DOCUMENT,
    // The ceiling is this layout's own box, never the terminal. Before it is measurable there is no
    // ceiling to apply, which is the honest answer: the floor still holds.
    ceiling: () => Math.floor(extent() * MAX_DOCUMENT_FRACTION),
  })
  const measure = (element: BoxRenderable) => setExtent(axis === 'x' ? element.width : element.height)

  return (
    <box
      flexDirection={axis === 'x' ? 'row' : 'column'}
      flexGrow={1}
      ref={(element: BoxRenderable) => {
        box = element
        measure(element)
        split.attach(element)
      }}
      onSizeChange={() => { if (box) measure(box) }}
    >
      <box
        flexDirection="column"
        {...(axis === 'x' ? { width: split.size() } : { height: split.size() })}
        ref={regionFocus({ paneId: props.stateKey, regionId: 'document' }, 0)}
      >
        {props.regions.document?.()}
      </box>
      <Rule axis={axis === 'x' ? 'y' : 'x'} />
      <box flexDirection="column" flexGrow={1} ref={regionFocus({ paneId: props.stateKey, regionId: 'frame' }, 1)}>
        {props.regions.frame?.()}
      </box>
    </box>
  )
}

export const DocumentOverFrame = documentSplit('y')
export const FrameBesideDocument = documentSplit('x')
