/** @jsxImportSource @acorn/tui/jsx */
import { Show } from 'solid-js'
import type { ExtendedPaneProps } from '@acorn/client-core/host/chrome/extendedPane.ts'
import { ExtensionRows, InlineSlot } from '../kit/host'
import { Line } from '../kit/cells'

// A plugin pane that reserved part of its rectangle for somebody else, in cells.
//
// The fourth of this host's seams, and the one that was a crash rather than a gap: the frame registry
// named `client-core/host/chrome/ChromeExtendedPane.tsx` directly, which is `<div class="extended-pane">`
// and an `<aside>` holding a `PanelGrid` sized in pixels, so a loaded plugin's pane that declared a
// footer or an aside handed the reconciler a `div` and it refused
// (client-core/host/chrome/extendedPane.ts, docs/tui.md § Loaded plugins).
//
// The regions the owner reserved are drawn in reading order under the owner's own tree rather than
// pinned around it. A terminal pane is one rectangle; there is no second column to give an aside and
// no row to spare for a strip that is empty most of the time.
export function ExtendedPane(props: ExtendedPaneProps) {
  return (
    <box flexDirection="column" flexGrow={1}>
      {props.children}
      {/* Two rectangles that need pixels, each named on one line so a reader knows the box was
          reserved and why it is empty (../kit/host.tsx § InlineSlot, docs/tui.md § Rectangles). */}
      <Show when={props.inlineBesidePointId}>{(pointId) => <InlineSlot point={pointId()} />}</Show>
      <Show when={props.inlineBelowPointId}>{(pointId) => <InlineSlot point={pointId()} />}</Show>
      {/* The `rows` kind, as a collection at the end of the pane. Draws nothing when nobody fills it. */}
      <Show when={props.footerPointId}>{(pointId) => <ExtensionRows point={pointId()} />}</Show>
      {/* `pane.aside` is a dashboard: a grid of panels sized in pixels, whose terminal projection is a
          design rather than a port and belongs with the dashboards programme
          (docs/future/dashboards/README.md). Named, for the same reason a rectangle is. */}
      <Show when={props.aside}>
        {(aside) => <Line role="muted">{`${aside().pointId} is a dashboard, so it is not drawn here.`}</Line>}
      </Show>
    </box>
  )
}
