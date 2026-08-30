import { createSplitDrag } from '../../kit/lib/split'
import { layoutState } from './state'
// Imported for `use:regionFocus` below: Solid compiles a directive to a bare reference, so the
// import has to be here even though nothing calls it.
// eslint-disable-next-line no-unused-vars -- used by the `use:regionFocus` directive.
import { regionFocus } from '../keys/focusRegions'
import type { LayoutProps } from './regions'

// `document-over-frame` and `frame-beside-document`: a host-owned editor and a plugin's region, with a
// host-owned drag handle between them.
//
// ┌──────────────────────────────────┐
// │ document region                  │  host: Monaco, theme, workers, dirty state, ⌘S, view state
// ├──────────────────────────────────┤  host: this layout's drag handle
// │ [picker] [Save] [Generate] [Run] │  the plugin's region starts here
// │ results grid                     │
// └──────────────────────────────────┘
//
// The reason the host composes this rather than the plugin: the frame CSP has `frame-src 'none'`, so a
// plugin can never embed host content inside its own layout. The restriction binds the plugin, not the
// host. The host is free to place its editor and the plugin's region side by side in its own DOM, and
// that inversion is the whole shape of the design.
//
// The two regions share no DOM and no JavaScript realm. Everything between them goes through the host:
// a frame reaches the document through `bridge.document`, and the host reaches the frame with a surface
// action when a chord lands in the editor.
//
// What is not a region: the button bar. Look at what database's bar actually holds, a searchable
// saved-queries picker with per-row delete chips, a Generate button visible only when a model
// connection exists, an Execute button disabled on connection status. A host-drawn action bar stops
// being cheap immediately. The bar is common, not impossible, so it is the plugin's, drawn as the first
// row of its own region.
//
// One component and two names, because the axis is in the name and never in a prop
// (docs/panes.md § Layout model, on adding a ninth).
//
// Narrow: the frame region collapses to a sheet the document can summon. Terminal: the document region
// is a host text view, read-only in a first version, and the frame region draws its tree.

// Matches the pixel height the compiled database pane opened at, so a move to this layout is not also a
// visual change.
const DEFAULT_DOCUMENT_SIZE = 200
const MIN_DOCUMENT_SIZE = 80
const MAX_DOCUMENT_FRACTION = 0.7

const documentSplit = (axis: 'x' | 'y') => (props: LayoutProps) => {
  const [size, setSize] = layoutState(props.stateKey, 'document-size', DEFAULT_DOCUMENT_SIZE)
  let root: HTMLDivElement | undefined
  let dragStart: number | null = null
  // The ceiling is this layout's own box, never the window. A pane is one column of a task row, so the
  // window is not what it is allowed to fill, and no layout may read the window's width (shell.css §
  // Layouts, docs/ui-design.md § What the kit and layouts must never do, "never do these" item 12). Before the element is
  // measurable there is no ceiling to apply, which is the honest answer: the floor still holds.
  const ceiling = () => {
    const extent = axis === 'x' ? (root?.offsetWidth ?? 0) : (root?.offsetHeight ?? 0)
    return extent > 0 ? extent * MAX_DOCUMENT_FRACTION : Number.POSITIVE_INFINITY
  }
  const drag = createSplitDrag({
    axis,
    label: `Resize ${props.label} editor`,
    onStart: () => { dragStart = size() },
    onDelta: (deltaPx) =>
      setSize(Math.min(Math.max((dragStart ?? size()) + deltaPx, MIN_DOCUMENT_SIZE), ceiling())),
    onCommit: () => { dragStart = null },
  })

  return (
    <div ref={root} class="pane layout-document-split" data-axis={axis}>
      <div
        class="layout-region-document"
        style={axis === 'x' ? { width: `${size()}px` } : { height: `${size()}px` }}
        use:regionFocus={{ paneId: props.stateKey, regionId: 'document' }}
      >
        {props.regions.document?.()}
      </div>
      <div {...drag.handleProps} class="ui-split-handle" data-axis={axis} />
      <div class="layout-region-frame" use:regionFocus={{ paneId: props.stateKey, regionId: 'frame' }}>{props.regions.frame?.()}</div>
    </div>
  )
}

export const DocumentOverFrame = documentSplit('y')
export const FrameBesideDocument = documentSplit('x')
