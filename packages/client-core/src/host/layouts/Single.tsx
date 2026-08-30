// Imported for `use:regionFocus` below: Solid compiles a directive to a bare reference, so the
// import has to be here even though nothing calls it.
// eslint-disable-next-line no-unused-vars -- used by the `use:regionFocus` directive.
import { regionFocus } from '../keys/focusRegions'
import type { LayoutProps } from './regions'

// `single`: one region, `body`.
//
// The trivial layout, and it earns its place by being declarable: a pane that is one tree still names a
// layout, so it inherits the focus group, the scrolling and the padding rules instead of inventing them.
//
// Narrow and terminal: the region, filling the host.
//
// One focus group, on the pane itself, so a pane that is one tree still answers the region chords.
export function Single(props: LayoutProps) {
  return (
    <div class="pane layout-single" use:regionFocus={{ paneId: props.stateKey, regionId: 'body' }}>
      {/* The body is its own box, and that box is the scroller. A region that manages its own
          scrolling — a document surface, a `ListDetail` — fills it and never overflows it; a region
          that is a plain run of content grows past it and this scrolls. Without the box, a pane that
          is one tree would be clipped at the bottom, because the layout root has to stay
          `overflow: hidden` for the regions that size themselves. */}
      <div class="layout-single-body">{props.regions.body?.()}</div>
    </div>
  )
}
