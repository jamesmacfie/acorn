import type { LayoutProps } from './regions'

// `single`: one region, `body`.
//
// The trivial layout, and it earns its place by being declarable: a pane that is one tree still names a
// layout, so it inherits the focus group and the padding rules instead of inventing them.
//
// Narrow and terminal: the region, filling the host.
export function Single(props: LayoutProps) {
  return <div class="pane layout-single">{props.regions.body?.()}</div>
}
