// Imported for `use:regionFocus` below: Solid compiles a directive to a bare reference, so the
// import has to be here even though nothing calls it.
// eslint-disable-next-line no-unused-vars -- used by the `use:regionFocus` directive.
import { regionFocus } from '../keys/regions'
import type { LayoutProps } from './regions'

// `single`: one region, `body`.
//
// The trivial layout, and it earns its place by being declarable: a pane that is one tree still names a
// layout, so it inherits the focus group and the padding rules instead of inventing them.
//
// Narrow and terminal: the region, filling the host.
//
// One focus group, on the pane itself, so a pane that is one tree still answers the region chords.
export function Single(props: LayoutProps) {
  return (
    <div class="pane layout-single" use:regionFocus={{ paneId: props.stateKey, regionId: 'body' }}>
      {props.regions.body?.()}
    </div>
  )
}
