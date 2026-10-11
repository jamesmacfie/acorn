/** @jsxImportSource @acorn/tui/jsx */
import { Show } from 'solid-js'
import { detailMountKey, type DetailRegions, type ExtendedPaneProps } from '@acorn/client-core/host/chrome'
import { ExtensionRows, InlineSlot, Slot } from '../kit/host'
import { Line } from '../kit/cells'

// A plugin pane that reserved part of its rectangle for somebody else, in cells.
//
// The DOM's `ChromeExtendedPane` is a `div` and an `aside` holding a `PanelGrid` sized in pixels, and
// the reconciler refuses it, so this host supplies its own through the `setExtendedPane` seam
// (docs/tui/plugins.md § Loaded plugins).
//
// The regions the owner reserved are drawn in reading order under the owner's own tree rather than
// pinned around it. A terminal pane is one rectangle; there is no second column to give an aside and
// no row to spare for a strip that is empty most of the time.
export function ExtendedPane(props: ExtendedPaneProps) {
  return (
    <box flexDirection="column" flexGrow={1}>
      <Show when={props.detail?.headerPointId}>
        {(pointId) => <DetailRegion point={pointId()} detail={props.detail!} />}
      </Show>
      {props.children}
      <Show when={props.detail?.footerPointId}>
        {(pointId) => <DetailRegion point={pointId()} detail={props.detail!} />}
      </Show>
      {/* Two rectangles that need pixels, each named on one line so a reader knows the box was
          reserved and why it is empty
          (../kit/host.tsx § InlineSlot, docs/tui/rectangles.md § Rectangles). */}
      <Show when={props.inlineBesidePointId}>{(pointId) => <InlineSlot point={pointId()} />}</Show>
      <Show when={props.inlineBelowPointId}>{(pointId) => <InlineSlot point={pointId()} />}</Show>
      {/* The `rows` kind, as a collection at the end of the pane. Draws nothing when nobody fills it. */}
      <Show when={props.footerPointId}>{(pointId) => <ExtensionRows point={pointId()} />}</Show>
      {/* `pane.aside` is a dashboard: a grid of panels sized in pixels, whose terminal projection is a
          design rather than a port (docs/dashboards.md). Named, for the same reason a rectangle is. */}
      <Show when={props.aside}>
        {(aside) => <Line role="muted">{`${aside().pointId} is a dashboard, so it is not drawn here.`}</Line>}
      </Show>
    </box>
  )
}

/** A region the owner mounted above or below its detail view, in cells. The same mount rule as the
 *  desktop's (client-core/host/chrome/DetailRegion.tsx), and capped at a third of the pane so the
 *  owner's view keeps its rows on a short terminal. Draws nothing when nobody fills it. */
function DetailRegion(props: { point: string; detail: DetailRegions }) {
  const subject = () => props.detail.subject()
  return (
    <Show when={detailMountKey(subject())} keyed>
      {(_key) => (
        <box flexDirection="column" flexShrink={0} maxHeight="30%" overflow="hidden">
          <Slot
            point={props.point}
            props={subject}
            {...(subject().projectId ? { projectId: subject().projectId } : {})}
          />
        </box>
      )}
    </Show>
  )
}
